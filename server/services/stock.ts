import type { Db, Row } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';

export interface MovementInput {
  labId: number;
  productId: number;
  type: 'IN' | 'OUT';
  quantity: number;
  party: string;
  note?: string;
  userId: number | null;
  referenceType?: 'goods_receipt' | null;
  referenceId?: number | null;
}

export interface MovementResult {
  transaction: Row;
  product: {
    id: number;
    name: string;
    sku: string;
    unit: string;
    previous_quantity: number;
    current_quantity: number;
  };
}

// THE ONLY function that changes products.quantity. Call it inside a transaction (withTransaction).
// It locks the product row (SELECT ... FOR UPDATE), checks available stock for OUT movements,
// updates the quantity and writes the transaction ledger row with balance_after.
export async function applyStockMovement(tx: Db, input: MovementInput): Promise<MovementResult> {
  const quantity = round2(Number(input.quantity));
  if (!(quantity > 0)) fail(400, 'VALIDATION_ERROR', 'quantity: Quantity must be greater than zero.');

  const productRes = await tx.query(
    `SELECT id, lab_id, sku, name, unit, quantity FROM products
     WHERE id = $1 AND lab_id = $2 AND is_active = true FOR UPDATE`,
    [input.productId, input.labId]
  );
  if (productRes.rows.length === 0) {
    fail(404, 'PRODUCT_NOT_FOUND', 'Product not found or has been archived in this laboratory.');
  }
  const product = productRes.rows[0];
  const current = toNumber(product.quantity);

  if (input.type === 'OUT' && quantity > current) {
    fail(409, 'INSUFFICIENT_STOCK', `Only ${current} ${current === 1 ? 'unit' : 'units'} available. Cannot issue ${quantity} units.`, {
      available_quantity: current,
    });
  }

  const next = round2(input.type === 'IN' ? current + quantity : current - quantity);
  await tx.query('UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2', [next, product.id]);

  const inserted = await tx.query(
    `INSERT INTO transactions (lab_id, product_id, product_name, type, quantity, balance_after, party, note, user_id, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.labId,
      product.id,
      product.name,
      input.type,
      quantity,
      next,
      input.party.trim(),
      (input.note ?? '').trim(),
      input.userId,
      input.referenceType ?? null,
      input.referenceId ?? null,
    ]
  );

  await writeAudit(tx, {
    actorId: input.userId,
    action: `stock.${input.type === 'IN' ? 'in' : 'out'}`,
    entityType: 'product',
    entityId: product.id,
    labId: input.labId,
    oldValue: { quantity: current },
    newValue: { quantity: next, movement: quantity, reference_type: input.referenceType ?? null, reference_id: input.referenceId ?? null },
  });

  return {
    transaction: inserted.rows[0],
    product: {
      id: Number(product.id),
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      previous_quantity: current,
      current_quantity: next,
    },
  };
}
