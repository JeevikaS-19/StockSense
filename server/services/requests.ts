import type { Db, Row } from '../db.ts';
import { fail } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { notifyAdmins, notifyUsers } from './notifications.ts';
import type { AuthUser } from '../middleware/auth.ts';

export interface RestockInput {
  product_id?: number | null;
  message: string;
  urgency: 'normal' | 'urgent';
}

// Staff raise restock requests for their own labs. Admins are notified straight away.
export async function createRestockRequest(tx: Db, labId: number, user: AuthUser, input: RestockInput): Promise<Row> {
  let productName: string | null = null;
  if (input.product_id) {
    const product = await tx.query('SELECT name FROM products WHERE id = $1 AND lab_id = $2 AND is_active = true', [input.product_id, labId]);
    if (product.rows.length === 0) fail(400, 'PRODUCT_NOT_FOUND', 'That product is not active in this laboratory.');
    productName = product.rows[0].name;
  }
  const res = await tx.query(
    `INSERT INTO restock_requests (lab_id, product_id, requested_by, message, urgency)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [labId, input.product_id ?? null, user.id, input.message.trim(), input.urgency]
  );
  const id = Number(res.rows[0].id);
  await writeAudit(tx, {
    actorId: user.id,
    action: 'restock.request',
    entityType: 'restock_request',
    entityId: id,
    labId,
    newValue: { product_id: input.product_id ?? null, urgency: input.urgency },
  });
  await notifyAdmins(tx, {
    labId,
    type: 'restock_request',
    title: `${input.urgency === 'urgent' ? 'Urgent restock' : 'Restock'} request${productName ? `: ${productName}` : ''}`,
    body: input.message.trim(),
    link: '/requests',
  });
  return getRequest(tx, id);
}

export async function resolveRestockRequest(tx: Db, id: number, admin: AuthUser): Promise<Row> {
  const current = await tx.query('SELECT id, lab_id, requested_by, status FROM restock_requests WHERE id = $1 FOR UPDATE', [id]);
  if (current.rows.length === 0) fail(404, 'NOT_FOUND', 'Restock request not found.');
  const row = current.rows[0];
  if (row.status === 'resolved') fail(409, 'INVALID_STATUS', 'This request is already resolved.');
  await tx.query(
    "UPDATE restock_requests SET status = 'resolved', resolved_by = $1, resolved_at = NOW() WHERE id = $2",
    [admin.id, id]
  );
  await writeAudit(tx, {
    actorId: admin.id,
    action: 'restock.resolve',
    entityType: 'restock_request',
    entityId: id,
    labId: Number(row.lab_id),
    oldValue: { status: 'open' },
    newValue: { status: 'resolved' },
  });
  await notifyUsers(tx, [Number(row.requested_by)], {
    labId: Number(row.lab_id),
    type: 'restock_resolved',
    title: 'Your restock request was resolved',
    link: '/requests',
  });
  return getRequest(tx, id);
}

export async function getRequest(db: Db, id: number): Promise<Row> {
  const res = await db.query(
    `SELECT r.id, r.lab_id, r.product_id, r.message, r.urgency, r.status, r.created_at, r.resolved_at,
            r.requested_by, requester.name AS requested_by_name, resolver.name AS resolved_by_name,
            l.name AS lab_name, l.code AS lab_code, p.name AS product_name, p.sku AS product_sku
     FROM restock_requests r
     JOIN labs l ON l.id = r.lab_id
     JOIN users requester ON requester.id = r.requested_by
     LEFT JOIN users resolver ON resolver.id = r.resolved_by
     LEFT JOIN products p ON p.id = r.product_id
     WHERE r.id = $1`,
    [id]
  );
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Restock request not found.');
  const row = res.rows[0];
  return { ...row, id: Number(row.id), lab_id: Number(row.lab_id), requested_by: Number(row.requested_by) };
}
