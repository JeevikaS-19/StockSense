import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db.ts';
import { asyncHandler, parse } from '../middleware/validate.ts';
import { requireAuth, assertLabAccess, type AuthRequest } from '../middleware/auth.ts';
import { applyStockMovement } from '../services/stock.ts';
import { runReorderScan } from '../services/reorder.ts';

export const stockRouter = Router();

const movementSchema = z.object({
  lab_id: z.coerce.number().int().positive('Laboratory is required'),
  product_id: z.coerce.number().int().positive('Product is required'),
  type: z.enum(['IN', 'OUT'], { message: 'Type must be IN or OUT' }),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  party: z.string().trim().min(1, 'Party (Supplier or Recipient) is required'),
  note: z.string().trim().optional().default(''),
});

// POST /api/stock/movement - the only route that records stock movements by hand.
stockRouter.post(
  '/movement',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(movementSchema, req.body);
    await assertLabAccess(req.user!, body.lab_id);

    const result = await withTransaction((tx) =>
      applyStockMovement(tx, {
        labId: body.lab_id,
        productId: body.product_id,
        type: body.type,
        quantity: body.quantity,
        party: body.party,
        note: body.note,
        userId: req.user!.id,
      })
    );

    // Reorder rules run after the OUT has committed. A failure here must not undo the movement.
    if (body.type === 'OUT') {
      await runReorderScan(body.lab_id, req.user!.id).catch((err) => console.error('[StockSense Reorder] Scan after OUT failed:', err));
    }

    res.status(201).json({
      success: true,
      transaction: result.transaction,
      product: {
        id: result.product.id,
        name: result.product.name,
        sku: result.product.sku,
        previous_quantity: result.product.previous_quantity,
        current_quantity: result.product.current_quantity,
      },
    });
  })
);
