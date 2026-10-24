import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction, type Db } from '../db.ts';
import { env } from '../env.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { asyncHandler, nullableInt, parse } from '../middleware/validate.ts';
import { assertLabAccess, isAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { generateText } from '../services/ai.ts';
import { getBudgetSummary } from '../services/budget.ts';
import { writeAudit } from '../services/audit.ts';
import { updateReorderFields } from '../services/reorder.ts';
import { createPurchaseOrderRow, recalcTotal } from '../services/purchaseOrders.ts';
import { buildReport, REPORT_TYPES, type ReportData } from '../services/reports.ts';
import { getInstitutionName } from '../services/settings.ts';
import { sendEmail } from '../services/email.ts';
import { inr } from '../services/format.ts';

export const aiRouter = Router();

// ---------- 1. Reorder threshold suggestions ----------

interface Suggestion {
  product_id: number;
  sku: string;
  name: string;
  avg_daily_usage: number;
  current_reorder_level: number;
  current_reorder_qty: number | null;
  lead_time_days: number;
  suggested_reorder_level: number;
  suggested_reorder_qty: number;
  eligible: boolean;
  reason: string;
}

const suggestionCache = new Map<number, { at: number; value: Suggestion[] }>();
const SUGGESTION_TTL_MS = 60 * 1000;

async function computeSuggestions(labId: number): Promise<Suggestion[]> {
  const lab = await db.query<{ safety_days: number }>('SELECT safety_days FROM labs WHERE id = $1', [labId]);
  const safetyDays = Number(lab.rows[0]?.safety_days ?? 3);
  const rows = await db.query(
    `SELECT p.id, p.sku, p.name, p.reorder_level, p.reorder_qty, p.lead_time_days,
       COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.product_id = p.id AND t.type = 'OUT'
                 AND t.created_at::date >= CURRENT_DATE - 29), 0) AS out_30,
       (SELECT MIN(t.created_at::date)::text FROM transactions t WHERE t.product_id = p.id) AS first_movement,
       CURRENT_DATE::text AS today
     FROM products p WHERE p.lab_id = $1 AND p.is_active = true ORDER BY p.name`,
    [labId]
  );

  return rows.rows.map((row) => {
    const avg = round2(toNumber(row.out_30) / 30);
    const lead = Number(row.lead_time_days);
    const hasHistory = row.first_movement !== null && Date.parse(row.today) - Date.parse(row.first_movement) >= 14 * 86400000;
    const suggestedLevel = Math.ceil(avg * (lead + safetyDays));
    const suggestedQty = Math.ceil(avg * 30);
    return {
      product_id: Number(row.id),
      sku: row.sku,
      name: row.name,
      avg_daily_usage: avg,
      current_reorder_level: toNumber(row.reorder_level),
      current_reorder_qty: row.reorder_qty === null ? null : Number(row.reorder_qty),
      lead_time_days: lead,
      suggested_reorder_level: suggestedLevel,
      suggested_reorder_qty: suggestedQty,
      eligible: hasHistory && avg > 0,
      reason: hasHistory
        ? avg > 0
          ? `Issues average ${avg} per day over the last 30 days.`
          : 'No issues in the last 30 days.'
        : 'Needs at least 14 days of history.',
    };
  });
}

async function withReasons(suggestions: Suggestion[]): Promise<Suggestion[]> {
  const eligible = suggestions.filter((s) => s.eligible);
  if (eligible.length === 0) return suggestions;
  const lines = eligible.map(
    (s) => `${s.sku} ${s.name}: ${s.avg_daily_usage} per day, lead time ${s.lead_time_days} days, suggested reorder point ${s.suggested_reorder_level}.`
  );
  const prompt = `For each line, write one short, plain sentence explaining the reorder suggestion. Use only the numbers given. Reply with one sentence per line, in the same order.\n${lines.join('\n')}`;
  const generated = await generateText(prompt, '');
  const replies = generated.text ? generated.text.split('\n').map((l) => l.replace(/^[-\d.)\s]+/, '').trim()).filter(Boolean) : [];
  eligible.forEach((s, index) => {
    if (replies[index]) s.reason = replies[index];
  });
  return suggestions;
}

// GET /api/ai/threshold-suggestions?lab_id= (cached for 60 seconds)
aiRouter.get(
  '/threshold-suggestions',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.query.lab_id);
    await assertLabAccess(req.user!, labId);
    const cached = suggestionCache.get(labId);
    if (cached && Date.now() - cached.at < SUGGESTION_TTL_MS) {
      res.json({ suggestions: cached.value, cached: true });
      return;
    }
    const value = await withReasons(await computeSuggestions(labId));
    suggestionCache.set(labId, { at: Date.now(), value });
    res.json({ suggestions: value, cached: false });
  })
);

// POST /api/ai/threshold-suggestions/apply - "Apply" (one product) or "Apply all". Each change is audited.
aiRouter.post(
  '/threshold-suggestions/apply',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(
      z.object({
        lab_id: z.coerce.number().int().positive(),
        product_ids: z.union([z.literal('all'), z.array(z.coerce.number().int().positive())]),
      }),
      req.body
    );
    await assertLabAccess(req.user!, body.lab_id);
    const suggestions = (await computeSuggestions(body.lab_id)).filter(
      (s) => s.eligible && (body.product_ids === 'all' || body.product_ids.includes(s.product_id))
    );
    await withTransaction(async (tx) => {
      for (const s of suggestions) {
        await updateReorderFields(tx, s.product_id, body.lab_id, {
          reorder_level: s.suggested_reorder_level,
          reorder_qty: s.suggested_reorder_qty,
        }, req.user!.id);
      }
    });
    suggestionCache.delete(body.lab_id);
    res.json({ applied: suggestions.length });
  })
);

// ---------- 2. Fit to budget ----------

async function poForFit(tx: Db, poId: number) {
  const po = await tx.query(
    `SELECT id, po_number, lab_id, supplier_id, status, total FROM purchase_orders WHERE id = $1 FOR UPDATE`,
    [poId]
  );
  if (po.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  return po.rows[0];
}

async function fitPlan(poId: number) {
  const po = (await db.query('SELECT id, lab_id, status, total FROM purchase_orders WHERE id = $1', [poId])).rows[0];
  if (!po) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  if (po.status !== 'draft') fail(409, 'INVALID_STATUS', 'Fit to budget works on draft orders only.');
  const summary = await getBudgetSummary(db, Number(po.lab_id));
  const total = round2(toNumber(po.total));
  const lines = await db.query(
    `SELECT i.id, i.description, i.qty_ordered, i.line_total, i.product_id, p.quantity AS on_hand,
       COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.product_id = p.id AND t.type = 'OUT' AND t.created_at::date >= CURRENT_DATE - 29), 0) AS out_30
     FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = $1`,
    [poId]
  );
  const ranked = lines.rows
    .map((row) => {
      const onHand = toNumber(row.on_hand);
      const daily = toNumber(row.out_30) / 30;
      // Days of stock left: out of stock first, then the lowest cover.
      const daysLeft = onHand <= 0 ? -1 : daily > 0 ? onHand / daily : Number.MAX_SAFE_INTEGER;
      return { id: Number(row.id), description: row.description, line_total: round2(toNumber(row.line_total)), days_left: daysLeft };
    })
    .sort((a, b) => a.days_left - b.days_left || a.id - b.id);

  let remaining = summary.available;
  const included: typeof ranked = [];
  const excluded: typeof ranked = [];
  for (const line of ranked) {
    if (line.line_total <= remaining) {
      included.push(line);
      remaining = round2(remaining - line.line_total);
    } else {
      excluded.push(line);
    }
  }
  return { po_id: poId, lab_id: Number(po.lab_id), total, available: summary.available, fits: total <= summary.available, included, excluded, remaining };
}

// POST /api/ai/fit-to-budget/preview
aiRouter.post(
  '/fit-to-budget/preview',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const poId = parse(z.object({ po_id: z.coerce.number().int().positive() }), req.body).po_id;
    const labId = (await db.query<{ lab_id: number }>('SELECT lab_id FROM purchase_orders WHERE id = $1', [poId])).rows[0]?.lab_id;
    if (!labId) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    await assertLabAccess(req.user!, Number(labId));
    const plan = await fitPlan(poId);
    const summary = `Budget covers ${plan.included.length} of ${plan.included.length + plan.excluded.length} items (${inr(plan.available)} available).`;
    const explanation = await generateText(
      `Write one short sentence explaining to a lab head why these lines were kept: ${plan.included.length} lines kept, ${plan.excluded.length} moved to a new draft, available budget ${plan.available}. Use only these numbers.`,
      `The lines most at risk of running out were kept first, within the ${inr(plan.available)} available.`
    );
    res.json({ plan, summary: plan.fits ? 'The order already fits the budget.' : summary, explanation: explanation.text });
  })
);

// POST /api/ai/fit-to-budget/confirm - keeps the chosen lines and moves the rest to a new draft for the same supplier.
aiRouter.post(
  '/fit-to-budget/confirm',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(
      z.object({ po_id: z.coerce.number().int().positive(), keep_item_ids: z.array(z.coerce.number().int().positive()) }),
      req.body
    );
    const labRow = (await db.query<{ lab_id: number }>('SELECT lab_id FROM purchase_orders WHERE id = $1', [body.po_id])).rows[0];
    if (!labRow) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    await assertLabAccess(req.user!, Number(labRow.lab_id));

    const newPoId = await withTransaction(async (tx) => {
      const po = await poForFit(tx, body.po_id);
      if (po.status !== 'draft') fail(409, 'INVALID_STATUS', 'Fit to budget works on draft orders only.');
      const items = await tx.query('SELECT id FROM purchase_order_items WHERE po_id = $1', [body.po_id]);
      const all = items.rows.map((row) => Number(row.id));
      const keep = new Set(body.keep_item_ids.filter((id) => all.includes(id)));
      const move = all.filter((id) => !keep.has(id));
      if (keep.size === 0) fail(400, 'VALIDATION_ERROR', 'Keep at least one item on this order.');
      if (move.length === 0) fail(400, 'VALIDATION_ERROR', 'Every item already fits; nothing to move.');

      const created = await createPurchaseOrderRow(tx, {
        labId: Number(po.lab_id),
        supplierId: Number(po.supplier_id),
        createdBy: req.user!.id,
        source: 'manual',
        notes: `Moved from ${po.po_number} by Fit to budget.`,
      });
      await tx.query('UPDATE purchase_order_items SET po_id = $1 WHERE id = ANY($2::int[])', [created.id, move]);
      await recalcTotal(tx, body.po_id);
      await recalcTotal(tx, Number(created.id));
      await writeAudit(tx, {
        actorId: req.user!.id,
        action: 'po.fit_to_budget',
        entityType: 'purchase_order',
        entityId: body.po_id,
        labId: Number(po.lab_id),
        oldValue: { item_ids: all },
        newValue: { kept: Array.from(keep), moved_to: created.id, moved: move },
      });
      return Number(created.id);
    });
    res.json({ moved_to: newPoId });
  })
);

// ---------- 3. Report summary ----------

function numbersText(report: ReportData): string {
  const parts: string[] = [];
  for (const section of report.sections) {
    if (section.totals) {
      const totals = Object.entries(section.totals)
        .filter(([key, value]) => key !== 'lab' && key !== 'category' && typeof value === 'number')
        .map(([key, value]) => `${key.replace(/_/g, ' ')} ${typeof value === 'number' && key !== 'difference' ? inr(value) : value}`);
      if (totals.length) parts.push(`${section.title}: ${totals.join(', ')}.`);
    }
  }
  if (report.sections.length > 0 && report.sections[0].rows.length) {
    parts.push(`${report.sections[0].rows.length} rows in ${report.sections[0].title.toLowerCase()}.`);
  }
  return parts.join(' ');
}

// POST /api/ai/report-summary - a 3 to 4 sentence summary written from the computed report numbers only.
aiRouter.post(
  '/report-summary',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(
      z.object({
        report_type: z.enum(REPORT_TYPES),
        lab_id: nullableInt(1),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      req.body
    );
    let labIds: number[] | null = null;
    let singleLab: { id: number; name: string; code: string } | null = null;
    if (body.lab_id) {
      await assertLabAccess(req.user!, body.lab_id);
      const lab = (await db.query('SELECT id, name, code FROM labs WHERE id = $1', [body.lab_id])).rows[0];
      labIds = [body.lab_id];
      singleLab = { id: Number(lab.id), name: lab.name, code: lab.code };
    } else if (!isAdmin(req.user!)) {
      labIds = (await db.query('SELECT lab_id FROM lab_members WHERE user_id = $1', [req.user!.id])).rows.map((row) => Number(row.lab_id));
    }
    const report = await buildReport(db, { type: body.report_type, labIds, singleLab, from: body.from ?? undefined, to: body.to ?? undefined });
    const facts = numbersText(report);
    const institution = await getInstitutionName();
    const fallback = `${report.title} for ${singleLab ? singleLab.name : 'all laboratories'} covering ${report.period.from} to ${report.period.to}. ${facts}`.trim();
    const generated = await generateText(
      `Write a 3 to 4 sentence plain-English summary for ${institution}. Use only these computed figures, do not add numbers: ${facts}`,
      fallback
    );
    res.json({ text: generated.text, source: generated.source, label: 'AI-assisted summary, review before use' });
  })
);

// ---------- 4. Supplier email draft ----------

async function poEmailDraft(poId: number) {
  const po = (await db.query(
    `SELECT po.po_number, po.lab_id, po.expected_date::text AS expected_date, po.supplier_id, s.name AS supplier_name, s.email AS supplier_email,
            l.name AS lab_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN labs l ON l.id = po.lab_id WHERE po.id = $1`,
    [poId]
  )).rows[0];
  if (!po) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  const items = await db.query('SELECT description, qty_ordered, unit_price FROM purchase_order_items WHERE po_id = $1 ORDER BY id', [poId]);
  const lines = items.rows.map((row) => `- ${row.description}: ${toNumber(row.qty_ordered)} x ${inr(toNumber(row.unit_price))}`);
  const institution = await getInstitutionName();
  const subject = `Purchase order ${po.po_number} from ${institution}`;
  const fallback = [
    `Dear ${po.supplier_name},`,
    '',
    `Please supply the items listed below for ${po.lab_name}, ${institution}.`,
    ...lines,
    '',
    po.expected_date ? `We would be grateful for delivery by ${po.expected_date}.` : 'We would be grateful for delivery at your earliest convenience.',
    '',
    'Thank you.',
    po.lab_name,
    institution,
  ].join('\n');
  const generated = await generateText(
    `Rewrite this polite purchase order message to a supplier. Keep every item, quantity and the delivery request. Plain text only:\n${fallback}`,
    fallback
  );
  return { subject, body: generated.text, source: generated.source, supplier_email: po.supplier_email as string | null, po_number: po.po_number as string };
}

// POST /api/ai/supplier-email/draft
aiRouter.post(
  '/supplier-email/draft',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const poId = parse(z.object({ po_id: z.coerce.number().int().positive() }), req.body).po_id;
    const labId = (await db.query<{ lab_id: number }>('SELECT lab_id FROM purchase_orders WHERE id = $1', [poId])).rows[0]?.lab_id;
    if (!labId) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    await assertLabAccess(req.user!, Number(labId));
    const draft = await poEmailDraft(poId);
    res.json({ subject: draft.subject, body: draft.body, source: draft.source });
  })
);

// POST /api/ai/supplier-email/send - only when RESEND_API_KEY is configured; otherwise reports that it was not sent.
aiRouter.post(
  '/supplier-email/send',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(
      z.object({ po_id: z.coerce.number().int().positive(), subject: z.string().trim().min(3), body: z.string().trim().min(10) }),
      req.body
    );
    const labId = (await db.query<{ lab_id: number }>('SELECT lab_id FROM purchase_orders WHERE id = $1', [body.po_id])).rows[0]?.lab_id;
    if (!labId) fail(404, 'NOT_FOUND', 'Purchase order not found.');
    await assertLabAccess(req.user!, Number(labId));
    const draft = await poEmailDraft(body.po_id);
    if (!env.resendApiKey) {
      res.json({ sent: false, reason: 'Email is not configured (RESEND_API_KEY is not set).' });
      return;
    }
    const sent = await sendEmail(draft.supplier_email, body.subject, body.body);
    await withTransaction((tx) =>
      writeAudit(tx, { actorId: req.user!.id, action: 'po.email_supplier', entityType: 'purchase_order', entityId: body.po_id, labId: Number(labId), newValue: { sent, subject: body.subject } })
    );
    res.json({ sent });
  })
);
