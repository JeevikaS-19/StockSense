import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { asyncHandler, parse, nullableInt } from '../middleware/validate.ts';
import { assertLabAccess, isAdmin, requireAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { createRestockRequest, resolveRestockRequest } from '../services/requests.ts';

export const requestsRouter = Router();

const createSchema = z.object({
  lab_id: z.coerce.number().int().positive('Laboratory is required'),
  product_id: nullableInt(1),
  message: z.string().trim().min(5, 'Describe what is needed (at least 5 characters).'),
  urgency: z.enum(['normal', 'urgent']).default('normal'),
});

// GET /api/requests?lab_id=&urgency=&status=
// Admins see every request (filterable). Staff see only the requests they raised.
requestsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (req.query.lab_id) {
      const labId = Number(req.query.lab_id);
      await assertLabAccess(req.user!, labId);
      params.push(labId);
      where.push(`r.lab_id = $${params.length}`);
    }
    if (!isAdmin(req.user!)) {
      params.push(req.user!.id);
      where.push(`r.requested_by = $${params.length}`);
    }
    if (req.query.urgency === 'normal' || req.query.urgency === 'urgent') {
      params.push(req.query.urgency);
      where.push(`r.urgency = $${params.length}`);
    }
    if (req.query.status === 'open' || req.query.status === 'resolved') {
      params.push(req.query.status);
      where.push(`r.status = $${params.length}`);
    }
    const rows = await db.query(
      `SELECT r.id, r.lab_id, r.product_id, r.message, r.urgency, r.status, r.created_at, r.resolved_at,
              r.requested_by, requester.name AS requested_by_name, resolver.name AS resolved_by_name,
              l.name AS lab_name, l.code AS lab_code, p.name AS product_name, p.sku AS product_sku
       FROM restock_requests r
       JOIN labs l ON l.id = r.lab_id
       JOIN users requester ON requester.id = r.requested_by
       LEFT JOIN users resolver ON resolver.id = r.resolved_by
       LEFT JOIN products p ON p.id = r.product_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (r.status = 'open') DESC, (r.urgency = 'urgent') DESC, r.id DESC
       LIMIT 200`,
      params
    );
    res.json({ requests: rows.rows.map((row) => ({ ...row, id: Number(row.id), lab_id: Number(row.lab_id), requested_by: Number(row.requested_by) })) });
  })
);

requestsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(createSchema, req.body);
    await assertLabAccess(req.user!, body.lab_id);
    const request = await withTransaction((tx) =>
      createRestockRequest(tx, body.lab_id, req.user!, { product_id: body.product_id, message: body.message, urgency: body.urgency })
    );
    res.status(201).json({ request });
  })
);

requestsRouter.post(
  '/:id/resolve',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const request = await withTransaction((tx) => resolveRestockRequest(tx, Number(req.params.id), req.user!));
    res.json({ request });
  })
);
