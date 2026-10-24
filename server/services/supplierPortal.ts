import { db, withTransaction } from '../db.ts';
import { fail, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { notifyAdmins } from './notifications.ts';

// The public supplier link (/supplier/po/:token) shows exactly one purchase order and nothing else.
// Internal fields (budget, approvals, audit trail) are never returned from here.
export async function getSupplierView(token: string) {
  const res = await db.query(
    `SELECT po.id, po.po_number, po.status, po.total, po.notes, po.expected_date::text AS expected_date,
            po.sent_at, po.supplier_confirmed_at, s.name AS supplier_name, l.name AS lab_name, l.department AS lab_department,
            l.location AS lab_location
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN labs l ON l.id = po.lab_id
     WHERE po.supplier_token = $1`,
    [token]
  );
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'This purchase order link is not valid.');
  const po = res.rows[0];

  const items = await db.query(
    `SELECT i.description, i.qty_ordered, i.unit_price, i.line_total, i.qty_received, i.qty_rejected
     FROM purchase_order_items i WHERE i.po_id = $1 ORDER BY i.id`,
    [po.id]
  );
  const invoices = await db.query(
    'SELECT invoice_number, invoice_date::text AS invoice_date, total, status, created_at FROM supplier_invoices WHERE po_id = $1 ORDER BY id DESC',
    [po.id]
  );

  return {
    po_number: po.po_number,
    status: po.status,
    total: toNumber(po.total),
    notes: po.notes,
    expected_date: po.expected_date,
    sent_at: po.sent_at,
    supplier_name: po.supplier_name,
    buyer: { name: po.lab_name, department: po.lab_department, location: po.lab_location },
    confirmed_at: po.supplier_confirmed_at,
    items: items.rows.map((row) => ({
      description: row.description,
      quantity: toNumber(row.qty_ordered),
      unit_price: toNumber(row.unit_price),
      line_total: toNumber(row.line_total),
      received: toNumber(row.qty_received),
      rejected: toNumber(row.qty_rejected),
    })),
    invoices: invoices.rows.map((row) => ({
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      total: toNumber(row.total),
      status: row.status,
    })),
  };
}

export async function confirmSupplierOrder(token: string) {
  await withTransaction(async (tx) => {
    const res = await tx.query(
      'SELECT id, lab_id, po_number, status, supplier_confirmed_at FROM purchase_orders WHERE supplier_token = $1 FOR UPDATE',
      [token]
    );
    if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'This purchase order link is not valid.');
    const po = res.rows[0];
    if (po.status !== 'sent') fail(409, 'INVALID_STATUS', 'This order is not awaiting confirmation.');
    if (po.supplier_confirmed_at) return;

    await tx.query('UPDATE purchase_orders SET supplier_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1', [po.id]);
    await writeAudit(tx, {
      actorId: null,
      action: 'po.supplier_confirm',
      entityType: 'purchase_order',
      entityId: po.id,
      labId: Number(po.lab_id),
      newValue: { confirmed_by: 'supplier', po_number: po.po_number },
    });
    await notifyAdmins(tx, {
      labId: Number(po.lab_id),
      type: 'po_confirmed',
      title: `Supplier confirmed ${po.po_number}`,
      link: `/purchase-orders/${po.id}`,
    });
  });
  return getSupplierView(token);
}

export async function resolvePoIdForToken(token: string): Promise<{ id: number; lab_id: number } | null> {
  const res = await db.query<{ id: number; lab_id: number }>('SELECT id, lab_id FROM purchase_orders WHERE supplier_token = $1', [token]);
  return res.rows[0] ?? null;
}
