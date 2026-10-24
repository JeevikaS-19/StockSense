import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { asyncHandler, parse, nullableInt } from '../middleware/validate.ts';
import { assertLabAccess, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { reorderOverview, runReorderScan, updateReorderFields } from '../services/reorder.ts';

export const reorderRouter = Router();

// GET /api/reorder?lab_id=
reorderRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.query.lab_id);
    await assertLabAccess(req.user!, labId);
    const products = await reorderOverview(db, labId);
    const lab = await db.query('SELECT name, code, automation_mode FROM labs WHERE id = $1', [labId]);
    res.json({
      lab: lab.rows[0],
      products,
      counts: {
        below_reorder_point: products.filter((p) => p.below_reorder_point).length,
        out_of_stock: products.filter((p) => p.out_of_stock).length,
        needs_supplier: products.filter((p) => p.needs_supplier).length,
      },
    });
  })
);

// POST /api/reorder/scan - "Generate draft POs" button.
reorderRouter.post(
  '/scan',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(z.object({ lab_id: z.coerce.number().int().positive() }), req.body);
    await assertLabAccess(req.user!, body.lab_id);
    const summary = await runReorderScan(body.lab_id, req.user!.id);
    res.json({ summary });
  })
);

const fieldsSchema = z.object({
  lab_id: z.coerce.number().int().positive(),
  reorder_level: z.coerce.number().min(0, 'Reorder point cannot be negative.').optional(),
  reorder_qty: nullableInt(1).optional(),
  lead_time_days: z.coerce.number().int().min(0, 'Lead time cannot be negative.').max(365).optional(),
});

// PUT /api/reorder/products/:id - inline edit of the three reorder fields (staff and admin).
reorderRouter.put(
  '/products/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(fieldsSchema, req.body);
    await assertLabAccess(req.user!, body.lab_id);
    const productId = Number(req.params.id);
    await withTransaction((tx) =>
      updateReorderFields(
        tx,
        productId,
        body.lab_id,
        { reorder_level: body.reorder_level, reorder_qty: body.reorder_qty, lead_time_days: body.lead_time_days },
        req.user!.id
      )
    );
    const row = (await reorderOverview(db, body.lab_id)).find((p) => p.id === productId);
    res.json({ product: row });
  })
);
