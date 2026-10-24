import { Router } from 'express';
import { db } from '../db.ts';
import { toNumber } from '../errors.ts';
import { asyncHandler } from '../middleware/validate.ts';
import { requireAuth, requireLabAccess, type AuthRequest } from '../middleware/auth.ts';

export const transactionsRouter = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/transactions?lab_id=&product_id=&type=&from=&to=&page=&limit=
transactionsRouter.get(
  '/',
  requireAuth,
  requireLabAccess,
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.query.lab_id);
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    const type = String(req.query.type ?? '');
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));

    const where: string[] = ['t.lab_id = $1'];
    const params: unknown[] = [labId];
    if (productId) {
      params.push(productId);
      where.push(`t.product_id = $${params.length}`);
    }
    if (type === 'IN' || type === 'OUT') {
      params.push(type);
      where.push(`t.type = $${params.length}`);
    }
    if (DATE.test(from)) {
      params.push(from);
      where.push(`t.created_at::date >= $${params.length}::date`);
    }
    if (DATE.test(to)) {
      params.push(to);
      where.push(`t.created_at::date <= $${params.length}::date`);
    }
    const whereSql = where.join(' AND ');

    const total = await db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM transactions t WHERE ${whereSql}`, params);
    const rows = await db.query(
      `SELECT t.id, t.lab_id, t.product_id, t.product_name, t.type, t.quantity, t.balance_after, t.party, t.note,
              t.user_id, t.created_at, t.reference_type, t.reference_id, u.name AS user_name, u.email AS user_email,
              gr.po_id AS reference_po_id, gr.receipt_no AS reference_receipt_no,
              po.po_number AS reference_po_number
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN goods_receipts gr ON t.reference_type = 'goods_receipt' AND gr.id = t.reference_id
       LEFT JOIN purchase_orders po ON po.id = gr.po_id
       WHERE ${whereSql}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );

    const count = total.rows[0].total;
    res.json({
      transactions: rows.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        quantity: toNumber(row.quantity),
        balance_after: toNumber(row.balance_after),
        reference_po_id: row.reference_po_id === null ? null : Number(row.reference_po_id),
        reference_id: row.reference_id === null ? null : Number(row.reference_id),
      })),
      pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) || 1 },
    });
  })
);
