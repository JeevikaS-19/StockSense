import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { toNumber } from '../errors.ts';
import { asyncHandler, parse } from '../middleware/validate.ts';
import { assertLabAccess, requireAdmin, requireAuth, requireLabAccess, type AuthRequest } from '../middleware/auth.ts';
import { getBudgetSummary, upsertBudget } from '../services/budget.ts';

export const budgetsRouter = Router();

const budgetSchema = z
  .object({
    lab_id: z.coerce.number().int().positive(),
    period_label: z.string().trim().min(3, 'Period label is required'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD'),
    allocated: z.coerce.number().min(0, 'Allocation cannot be negative.').max(9999999999.99),
  })
  .refine((value) => value.end_date >= value.start_date, { message: 'The end date must be on or after the start date.', path: ['end_date'] });

// GET /api/budgets/summary?lab_id=
budgetsRouter.get(
  '/summary',
  requireAuth,
  requireLabAccess,
  asyncHandler(async (req, res) => {
    const labId = Number(req.query.lab_id);
    const summary = await getBudgetSummary(db, labId);
    res.json({ summary });
  })
);

// PUT /api/budgets (admin): creates the active budget or edits its allocation, period and dates.
budgetsRouter.put(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(budgetSchema, req.body);
    await withTransaction((tx) => upsertBudget(tx, body.lab_id, body, req.user!.id));
    res.json({ summary: await getBudgetSummary(db, body.lab_id) });
  })
);

// GET /api/budgets/ledger?lab_id=&page=&limit= (read-only)
budgetsRouter.get(
  '/ledger',
  requireAuth,
  requireLabAccess,
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.query.lab_id);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '15'), 10) || 15));
    await assertLabAccess(req.user!, labId);

    const total = await db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM budget_ledger WHERE lab_id = $1', [labId]);
    const rows = await db.query(
      `SELECT bl.id, bl.entry_type, bl.amount, bl.note, bl.created_at, bl.po_id, po.po_number, u.name AS user_name
       FROM budget_ledger bl
       LEFT JOIN purchase_orders po ON po.id = bl.po_id
       LEFT JOIN users u ON u.id = bl.created_by
       WHERE bl.lab_id = $1
       ORDER BY bl.created_at DESC, bl.id DESC
       LIMIT $2 OFFSET $3`,
      [labId, limit, (page - 1) * limit]
    );
    const count = total.rows[0].total;
    res.json({
      entries: rows.rows.map((row) => ({ ...row, id: Number(row.id), amount: toNumber(row.amount), po_id: row.po_id === null ? null : Number(row.po_id) })),
      pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) || 1 },
    });
  })
);
