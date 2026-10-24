import crypto from 'crypto';
import type { Db, Row } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { currentYear, nextNumber, pad } from './sequences.ts';
import { notifyAdmins, notifyUsers } from './notifications.ts';
import { activeBudget, assertBudgetAvailable, getBudgetSummary, latestBudget, lockBudget, recordLedgerEntry } from './budget.ts';
import { inr } from './format.ts';

// Statuses whose outstanding quantities count as "on order" and toward effective stock.
export const OPEN_STATUS_SQL = "('draft', 'pending_approval', 'approved', 'sent', 'partially_received')";

export interface LineInput {
  product_id: number;
  quantity: number;
  unit_price?: number;
}

const PO_COLUMNS = `id, po_number, lab_id, supplier_id, status, total, notes, source, created_by, approved_by,
  approved_at, rejection_reason, cancel_reason, close_reason, sent_at, expected_date::text AS expected_date,
  supplier_token, supplier_confirmed_at, created_at, updated_at`;

function invalidStatus(status: string, action: string): never {
  fail(409, 'INVALID_STATUS', `This purchase order is ${status.replace(/_/g, ' ')} and cannot be ${action}.`, { status });
}

export async function loadPo(tx: Db, id: number, lock = false): Promise<Row> {
  const res = await tx.query(`SELECT ${PO_COLUMNS} FROM purchase_orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  const row = res.rows[0];
  return { ...row, id: Number(row.id), lab_id: Number(row.lab_id), supplier_id: Number(row.supplier_id), total: toNumber(row.total) };
}

async function labCode(tx: Db, labId: number): Promise<string> {
  const res = await tx.query<{ code: string }>('SELECT code FROM labs WHERE id = $1', [labId]);
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Laboratory not found.');
  return res.rows[0].code;
}

export async function createPurchaseOrderRow(
  tx: Db,
  input: { labId: number; supplierId: number; createdBy: number | null; source: 'manual' | 'auto'; notes?: string }
): Promise<Row> {
  const year = currentYear();
  const code = await labCode(tx, input.labId);
  const seq = await nextNumber(tx, input.labId, 'PO', year);
  const poNumber = `PO-${year}-${code}-${pad(seq)}`;
  const token = crypto.randomBytes(24).toString('hex');

  const res = await tx.query(
    `INSERT INTO purchase_orders (po_number, lab_id, supplier_id, status, notes, source, created_by, supplier_token)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)
     RETURNING id`,
    [poNumber, input.labId, input.supplierId, input.notes ?? '', input.source, input.createdBy, token]
  );
  const id = Number(res.rows[0].id);
  await writeAudit(tx, {
    actorId: input.createdBy,
    action: 'po.created',
    entityType: 'purchase_order',
    entityId: id,
    labId: input.labId,
    newValue: { po_number: poNumber, supplier_id: input.supplierId, source: input.source },
  });
  return loadPo(tx, id);
}

// Adds lines to a purchase order. Products must belong to the PO's lab and be active.
export async function addLines(tx: Db, po: Row, lines: LineInput[], actorId: number | null): Promise<void> {
  for (const line of lines) {
    const quantity = round2(Number(line.quantity));
    if (!(quantity > 0)) fail(400, 'VALIDATION_ERROR', 'quantity: Quantity must be greater than zero.');

    const productRes = await tx.query(
      'SELECT id, name, sku, unit_price FROM products WHERE id = $1 AND lab_id = $2 AND is_active = true',
      [line.product_id, po.lab_id]
    );
    if (productRes.rows.length === 0) fail(400, 'PRODUCT_NOT_FOUND', 'One of the products is not active in this laboratory.');
    const product = productRes.rows[0];

    const unitPrice = round2(line.unit_price !== undefined ? Number(line.unit_price) : toNumber(product.unit_price));
    if (!(unitPrice >= 0)) fail(400, 'VALIDATION_ERROR', 'unit_price: Unit price cannot be negative.');
    const lineTotal = round2(quantity * unitPrice);

    const inserted = await tx.query(
      `INSERT INTO purchase_order_items (po_id, product_id, description, qty_ordered, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [po.id, product.id, `${product.sku} ${product.name}`, quantity, unitPrice, lineTotal]
    );
    await writeAudit(tx, {
      actorId,
      action: 'po.item_added',
      entityType: 'purchase_order',
      entityId: po.id,
      labId: po.lab_id,
      newValue: { item_id: Number(inserted.rows[0].id), product_id: product.id, quantity, unit_price: unitPrice, line_total: lineTotal },
    });
  }
  await recalcTotal(tx, po.id);
}

export async function recalcTotal(tx: Db, poId: number): Promise<number> {
  const res = await tx.query<{ total: string }>(
    `UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_items WHERE po_id = $1),
       updated_at = NOW()
     WHERE id = $1 RETURNING total`,
    [poId]
  );
  return round2(toNumber(res.rows[0].total));
}

// Replaces every line of a draft. Lines of a draft cannot have receipts, so this is safe.
export async function replaceDraftLines(tx: Db, poId: number, lines: LineInput[], actorId: number): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'draft') invalidStatus(po.status, 'edited');
  const before = await tx.query('SELECT product_id, qty_ordered, unit_price FROM purchase_order_items WHERE po_id = $1', [poId]);
  await tx.query('DELETE FROM purchase_order_items WHERE po_id = $1', [poId]);
  await addLines(tx, po, lines, actorId);
  await writeAudit(tx, {
    actorId,
    action: 'po.items_replaced',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: before.rows,
    newValue: lines,
  });
  return loadPo(tx, poId);
}

export async function submitPurchaseOrder(tx: Db, poId: number, actorId: number | null): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'draft') invalidStatus(po.status, 'submitted');
  const count = await tx.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchase_order_items WHERE po_id = $1', [poId]);
  if (count.rows[0].n === 0) fail(400, 'EMPTY_PO', 'Add at least one item before submitting for approval.');

  await tx.query("UPDATE purchase_orders SET status = 'pending_approval', updated_at = NOW() WHERE id = $1", [poId]);
  await writeAudit(tx, {
    actorId,
    action: 'po.submit',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: 'draft' },
    newValue: { status: 'pending_approval', total: po.total },
  });
  await notifyAdmins(tx, {
    labId: po.lab_id,
    type: 'po_pending_approval',
    title: `${po.po_number} awaiting approval`,
    body: `Total ${inr(po.total)}.`,
    link: `/purchase-orders/${poId}`,
  });
  return loadPo(tx, poId);
}

export interface ApproveOptions {
  override?: boolean;
  reason?: string;
}

// Approves a pending order. Locks the lab's budget, checks availability, records the commitment.
// An override bypasses the budget check only when a written reason is supplied, and is audited.
export async function approvePurchaseOrder(tx: Db, poId: number, actorId: number | null, options: ApproveOptions = {}): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'pending_approval') invalidStatus(po.status, 'approved');

  const budget = await activeBudget(tx, po.lab_id);
  if (!budget) {
    fail(409, 'NO_ACTIVE_BUDGET', 'Set this laboratory’s budget allocation on the Budget page before approving purchase orders.');
  }
  await lockBudget(tx, Number(budget.id));

  const total = round2(po.total);
  if (!(total > 0)) fail(400, 'EMPTY_PO', 'This purchase order has no value to approve.');

  const check = await assertBudgetAvailable(tx, po.lab_id, total);
  let overridden = false;
  if (!check.ok) {
    if (!options.override) {
      fail(
        409,
        'BUDGET_EXCEEDED',
        `This order is ${inr(total)} but only ${inr(check.available)} is available. Short by ${inr(check.shortfall)}.`,
        { shortfall: check.shortfall, available: check.available, order_total: total }
      );
    }
    if (!options.reason || options.reason.trim().length < 5) {
      fail(400, 'OVERRIDE_REASON_REQUIRED', 'A written reason (at least 5 characters) is required to approve over budget.');
    }
    overridden = true;
  }

  await tx.query(
    "UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2",
    [actorId, poId]
  );
  await recordLedgerEntry(tx, {
    labId: po.lab_id,
    budgetId: Number(budget.id),
    poId,
    entryType: 'commit',
    amount: total,
    note: `Approved ${po.po_number}`,
    userId: actorId,
  });
  await writeAudit(tx, {
    actorId,
    action: 'po.approve',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: 'pending_approval' },
    newValue: {
      status: 'approved',
      total,
      override: overridden,
      override_reason: overridden ? options.reason!.trim() : null,
      budget_available_before: check.available,
    },
  });
  if (po.created_by) {
    await notifyUsers(tx, [po.created_by], {
      labId: po.lab_id,
      type: 'po_approved',
      title: `${po.po_number} approved`,
      body: `Total ${inr(total)}.`,
      link: `/purchase-orders/${poId}`,
    });
  }
  return loadPo(tx, poId);
}

export async function rejectPurchaseOrder(tx: Db, poId: number, actorId: number, reason: string): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'pending_approval') invalidStatus(po.status, 'rejected');
  await tx.query(
    "UPDATE purchase_orders SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2",
    [reason.trim(), poId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'po.reject',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: 'pending_approval' },
    newValue: { status: 'rejected', reason: reason.trim() },
  });
  if (po.created_by) {
    await notifyUsers(tx, [po.created_by], {
      labId: po.lab_id,
      type: 'po_rejected',
      title: `${po.po_number} rejected`,
      body: reason.trim(),
      link: `/purchase-orders/${poId}`,
    });
  }
  return loadPo(tx, poId);
}

// Cancels a draft, a pending order, or an approved order. An approved order releases its commitment.
export async function cancelPurchaseOrder(tx: Db, poId: number, actorId: number, reason: string): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (!['draft', 'pending_approval', 'approved'].includes(po.status)) invalidStatus(po.status, 'cancelled');

  if (po.status === 'approved') {
    const budget = await latestBudget(tx, po.lab_id);
    if (budget) {
      await recordLedgerEntry(tx, {
        labId: po.lab_id,
        budgetId: Number(budget.id),
        poId,
        entryType: 'release',
        amount: po.total,
        note: `Cancelled ${po.po_number}`,
        userId: actorId,
      });
    }
  }

  await tx.query(
    "UPDATE purchase_orders SET status = 'cancelled', cancel_reason = $1, updated_at = NOW() WHERE id = $2",
    [reason.trim(), poId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'po.cancel',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: po.status },
    newValue: { status: 'cancelled', reason: reason.trim() },
  });
  return loadPo(tx, poId);
}

// Marks an approved order as sent. Expected delivery = today + the longest lead time among its products.
export async function sendPurchaseOrder(tx: Db, poId: number, actorId: number | null): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'approved') invalidStatus(po.status, 'sent');

  const lead = await tx.query<{ days: number }>(
    `SELECT COALESCE(MAX(p.lead_time_days), 7)::int AS days
     FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = $1`,
    [poId]
  );
  await tx.query(
    `UPDATE purchase_orders SET status = 'sent', sent_at = NOW(), expected_date = CURRENT_DATE + $1::int, updated_at = NOW()
     WHERE id = $2`,
    [lead.rows[0].days, poId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'po.send',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: 'approved' },
    newValue: { status: 'sent', lead_time_days: lead.rows[0].days },
  });
  return loadPo(tx, poId);
}

// Short-closes a partially received order: releases the commitment for everything not yet delivered.
export async function closePurchaseOrder(tx: Db, poId: number, actorId: number, reason: string): Promise<Row> {
  const po = await loadPo(tx, poId, true);
  if (po.status !== 'partially_received') invalidStatus(po.status, 'closed');

  const remaining = await tx.query<{ value: string }>(
    `SELECT COALESCE(SUM((qty_ordered - qty_received - qty_rejected) * unit_price), 0) AS value
     FROM purchase_order_items WHERE po_id = $1`,
    [poId]
  );
  const releaseValue = round2(toNumber(remaining.rows[0].value));

  const budget = await latestBudget(tx, po.lab_id);
  if (budget && releaseValue > 0) {
    await recordLedgerEntry(tx, {
      labId: po.lab_id,
      budgetId: Number(budget.id),
      poId,
      entryType: 'release',
      amount: releaseValue,
      note: `Short-closed ${po.po_number}`,
      userId: actorId,
    });
  }

  await tx.query(
    "UPDATE purchase_orders SET status = 'closed', close_reason = $1, updated_at = NOW() WHERE id = $2",
    [reason.trim(), poId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'po.close',
    entityType: 'purchase_order',
    entityId: poId,
    labId: po.lab_id,
    oldValue: { status: 'partially_received' },
    newValue: { status: 'closed', reason: reason.trim(), released: releaseValue },
  });
  return loadPo(tx, poId);
}

export interface PurchaseOrderFilter {
  labIds: number[] | null; // null = every lab (admin)
  status?: string;
  supplierId?: number;
}

export async function listPurchaseOrders(db: Db, filter: PurchaseOrderFilter): Promise<Row[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.labIds) {
    params.push(filter.labIds);
    where.push(`po.lab_id = ANY($${params.length}::int[])`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`po.status = $${params.length}`);
  }
  if (filter.supplierId) {
    params.push(filter.supplierId);
    where.push(`po.supplier_id = $${params.length}`);
  }
  const res = await db.query(
    `SELECT po.id, po.po_number, po.lab_id, po.supplier_id, po.status, po.total, po.source,
            po.expected_date::text AS expected_date, po.created_at, s.name AS supplier_name,
            l.name AS lab_name, l.code AS lab_code,
            (SELECT COUNT(*)::int FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN labs l ON l.id = po.lab_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT 300`,
    params
  );
  return res.rows.map((row) => ({ ...row, id: Number(row.id), total: toNumber(row.total) }));
}

export async function getPurchaseOrderDetail(db: Db, poId: number): Promise<Row> {
  const headRes = await db.query(
    `SELECT po.id, po.po_number, po.lab_id, po.supplier_id, po.status, po.total, po.notes, po.source,
            po.created_by, creator.name AS created_by_name, po.approved_by, approver.name AS approved_by_name,
            po.approved_at, po.rejection_reason, po.cancel_reason, po.close_reason, po.sent_at,
            po.expected_date::text AS expected_date, po.supplier_token, po.supplier_confirmed_at,
            po.created_at, po.updated_at,
            s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone,
            s.address AS supplier_address, s.contact_person AS supplier_contact,
            l.name AS lab_name, l.code AS lab_code, l.department AS lab_department, l.location AS lab_location
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN labs l ON l.id = po.lab_id
     LEFT JOIN users creator ON creator.id = po.created_by
     LEFT JOIN users approver ON approver.id = po.approved_by
     WHERE po.id = $1`,
    [poId]
  );
  if (headRes.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  const head = headRes.rows[0];

  const items = await db.query(
    `SELECT i.id, i.product_id, p.sku, p.name AS product_name, i.description, p.unit,
            i.qty_ordered, i.unit_price, i.line_total, i.qty_received, i.qty_rejected,
            (i.qty_ordered - i.qty_received - i.qty_rejected) AS outstanding,
            p.quantity AS on_hand, p.lead_time_days
     FROM purchase_order_items i JOIN products p ON p.id = i.product_id
     WHERE i.po_id = $1 ORDER BY i.id`,
    [poId]
  );

  const receipts = await db.query(
    `SELECT r.id, r.receipt_no, r.received_at, r.delivery_reference, r.note, u.name AS received_by_name
     FROM goods_receipts r LEFT JOIN users u ON u.id = r.received_by
     WHERE r.po_id = $1 ORDER BY r.id`,
    [poId]
  );
  const receiptLines = await db.query(
    `SELECT rl.id, rl.receipt_id, rl.po_item_id, rl.qty_accepted, rl.qty_rejected, rl.reject_reason, rl.note
     FROM goods_receipt_lines rl JOIN goods_receipts r ON r.id = rl.receipt_id
     WHERE r.po_id = $1 ORDER BY rl.id`,
    [poId]
  );

  const invoices = await db.query(
    `SELECT id, invoice_number, invoice_date::text AS invoice_date, subtotal, tax, total, status,
            extraction_source, comparison, extracted, original_filename, note, created_at
     FROM supplier_invoices WHERE po_id = $1 ORDER BY id DESC`,
    [poId]
  );

  // $1 is the integer PO id; $2 is the same id as text, because audit_log.entity_id is text.
  const activity = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.old_value, a.new_value, a.created_at, u.name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE (a.entity_type = 'purchase_order' AND a.entity_id = $2)
        OR (a.entity_type = 'goods_receipt' AND a.entity_id IN (SELECT id::text FROM goods_receipts WHERE po_id = $1))
        OR (a.entity_type = 'supplier_invoice' AND a.entity_id IN (SELECT id::text FROM supplier_invoices WHERE po_id = $1))
     ORDER BY a.id DESC LIMIT 100`,
    [poId, String(poId)]
  );

  const budget = await getBudgetSummary(db, Number(head.lab_id));
  const total = toNumber(head.total);
  const reservesBudget = ['draft', 'pending_approval'].includes(head.status);

  return {
    ...head,
    id: Number(head.id),
    lab_id: Number(head.lab_id),
    supplier_id: Number(head.supplier_id),
    total,
    items: items.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      product_id: Number(row.product_id),
      qty_ordered: toNumber(row.qty_ordered),
      unit_price: toNumber(row.unit_price),
      line_total: toNumber(row.line_total),
      qty_received: toNumber(row.qty_received),
      qty_rejected: toNumber(row.qty_rejected),
      outstanding: round2(toNumber(row.outstanding)),
      on_hand: toNumber(row.on_hand),
      lead_time_days: Number(row.lead_time_days),
    })),
    receipts: receipts.rows.map((receipt) => ({
      ...receipt,
      id: Number(receipt.id),
      lines: receiptLines.rows
        .filter((line) => Number(line.receipt_id) === Number(receipt.id))
        .map((line) => ({
          ...line,
          id: Number(line.id),
          po_item_id: Number(line.po_item_id),
          qty_accepted: toNumber(line.qty_accepted),
          qty_rejected: toNumber(line.qty_rejected),
        })),
    })),
    invoices: invoices.rows.map((invoice) => ({ ...invoice, id: Number(invoice.id), total: toNumber(invoice.total), subtotal: toNumber(invoice.subtotal), tax: toNumber(invoice.tax) })),
    activity: activity.rows.map((row) => ({ ...row, id: Number(row.id) })),
    budget_impact: {
      available_now: budget.available,
      po_total: total,
      available_after: reservesBudget ? round2(budget.available - total) : budget.available,
      reserves_budget: reservesBudget,
    },
  };
}

// The lab's open draft for a supplier, locked for update. Reorder scans add lines to this draft
// instead of creating a second one.
export async function openDraftForSupplier(db: Db, labId: number, supplierId: number): Promise<Row | null> {
  const res = await db.query(
    "SELECT id, po_number, lab_id, status FROM purchase_orders WHERE lab_id = $1 AND supplier_id = $2 AND status = 'draft' ORDER BY id LIMIT 1 FOR UPDATE",
    [labId, supplierId]
  );
  return res.rows[0] ?? null;
}
