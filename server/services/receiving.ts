import type { Db, Row } from '../db.ts';
import { withTransaction } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { currentYear, nextNumber, pad } from './sequences.ts';
import { notifyAdmins } from './notifications.ts';
import { applyStockMovement } from './stock.ts';
import { latestBudget, recordLedgerEntry } from './budget.ts';
import { loadPo } from './purchaseOrders.ts';

export const REJECT_REASONS = ['damaged', 'short', 'wrong_item', 'other'] as const;

export interface ReceiptLineInput {
  po_item_id: number;
  qty_accepted: number;
  qty_rejected: number;
  reject_reason?: (typeof REJECT_REASONS)[number] | null;
  note?: string;
}

export interface ReceiptInput {
  delivery_reference: string;
  received_at?: string | null;
  note?: string;
  lines: ReceiptLineInput[];
}

// Records a goods receipt. Stock changes only here (and in stock movements), never on send or invoice.
// Everything happens in one transaction with the PO and its items locked.
export function receiveGoods(poId: number, actorId: number, input: ReceiptInput): Promise<Row> {
  return withTransaction(async (tx) => {
    const po = await loadPo(tx, poId, true);
    if (!['sent', 'partially_received'].includes(po.status)) {
      fail(409, 'INVALID_STATUS', `Goods can only be received against a sent order. This order is ${po.status.replace(/_/g, ' ')}.`, {
        status: po.status,
      });
    }

    const itemRes = await tx.query('SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id FOR UPDATE', [poId]);
    const items = new Map<number, Row>(itemRes.rows.map((row) => [Number(row.id), row]));

    let anyQuantity = false;
    for (const line of input.lines) {
      const item = items.get(Number(line.po_item_id));
      if (!item) fail(400, 'VALIDATION_ERROR', 'A receipt line does not belong to this purchase order.');
      const accepted = round2(Number(line.qty_accepted) || 0);
      const rejected = round2(Number(line.qty_rejected) || 0);
      if (accepted < 0 || rejected < 0) fail(400, 'VALIDATION_ERROR', 'Quantities cannot be negative.');
      if (accepted + rejected === 0) continue;

      anyQuantity = true;
      const outstanding = round2(toNumber(item.qty_ordered) - toNumber(item.qty_received) - toNumber(item.qty_rejected));
      if (round2(accepted + rejected) > outstanding) {
        fail(409, 'OVER_DELIVERY', `Accepted plus rejected for ${item.description} cannot exceed the ${outstanding} still outstanding.`, {
          outstanding,
          po_item_id: item.id,
        });
      }
      if (rejected > 0 && !line.reject_reason) {
        fail(400, 'VALIDATION_ERROR', `reject_reason: Choose a reason for the rejected units of ${item.description}.`);
      }
    }
    if (!anyQuantity) fail(400, 'VALIDATION_ERROR', 'Enter an accepted or rejected quantity for at least one line.');

    const year = currentYear();
    const labRes = await tx.query<{ code: string }>('SELECT code FROM labs WHERE id = $1', [po.lab_id]);
    const seq = await nextNumber(tx, po.lab_id, 'GRN', year);
    const receiptNo = `GRN-${year}-${labRes.rows[0].code}-${pad(seq)}`;

    const receiptRes = await tx.query(
      `INSERT INTO goods_receipts (receipt_no, po_id, lab_id, received_by, received_at, delivery_reference, note)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7) RETURNING id`,
      [receiptNo, poId, po.lab_id, actorId, input.received_at || null, input.delivery_reference.trim(), (input.note ?? '').trim()]
    );
    const receiptId = Number(receiptRes.rows[0].id);

    const supplierRes = await tx.query<{ name: string }>('SELECT name FROM suppliers WHERE id = $1', [po.supplier_id]);
    const supplierName = supplierRes.rows[0].name;

    // Once an invoice is accepted, its unit prices become the spend price for matching lines.
    const acceptedInvoice = await tx.query(
      "SELECT extracted FROM supplier_invoices WHERE po_id = $1 AND status = 'accepted' ORDER BY id DESC LIMIT 1",
      [poId]
    );
    const invoicePrice = new Map<number, number>();
    for (const row of acceptedInvoice.rows[0]?.extracted?.items ?? []) {
      if (row && row.po_item_id && Number.isFinite(Number(row.unit_price))) {
        invoicePrice.set(Number(row.po_item_id), Number(row.unit_price));
      }
    }

    const budget = await latestBudget(tx, po.lab_id);
    let rejectedAny = false;

    for (const line of input.lines) {
      const item = items.get(Number(line.po_item_id))!;
      const accepted = round2(Number(line.qty_accepted) || 0);
      const rejected = round2(Number(line.qty_rejected) || 0);
      if (accepted + rejected === 0) continue;
      if (rejected > 0) rejectedAny = true;

      await tx.query(
        `INSERT INTO goods_receipt_lines (receipt_id, po_item_id, qty_accepted, qty_rejected, reject_reason, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [receiptId, item.id, accepted, rejected, rejected > 0 ? line.reject_reason : null, (line.note ?? '').trim()]
      );

      if (accepted > 0) {
        await applyStockMovement(tx, {
          labId: po.lab_id,
          productId: Number(item.product_id),
          type: 'IN',
          quantity: accepted,
          party: supplierName,
          note: `Received against ${po.po_number}`,
          userId: actorId,
          referenceType: 'goods_receipt',
          referenceId: receiptId,
        });
      }

      await tx.query(
        'UPDATE purchase_order_items SET qty_received = qty_received + $1, qty_rejected = qty_rejected + $2 WHERE id = $3',
        [accepted, rejected, item.id]
      );

      if (budget) {
        const unitPrice = toNumber(item.unit_price);
        const releaseAmount = round2((accepted + rejected) * unitPrice);
        await recordLedgerEntry(tx, {
          labId: po.lab_id,
          budgetId: Number(budget.id),
          poId,
          entryType: 'release',
          amount: releaseAmount,
          note: `Receipt ${receiptNo}`,
          userId: actorId,
        });
        const spendPrice = invoicePrice.get(Number(item.id)) ?? unitPrice;
        await recordLedgerEntry(tx, {
          labId: po.lab_id,
          budgetId: Number(budget.id),
          poId,
          entryType: 'spend',
          amount: round2(accepted * spendPrice),
          note: `Receipt ${receiptNo}`,
          userId: actorId,
        });
      }
    }

    const remaining = await tx.query<{ value: string }>(
      'SELECT COALESCE(SUM(qty_ordered - qty_received - qty_rejected), 0) AS value FROM purchase_order_items WHERE po_id = $1',
      [poId]
    );
    const nextStatus = toNumber(remaining.rows[0].value) > 0 ? 'partially_received' : 'received';
    await tx.query('UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2', [nextStatus, poId]);

    await writeAudit(tx, {
      actorId,
      action: 'receipt.create',
      entityType: 'goods_receipt',
      entityId: receiptId,
      labId: po.lab_id,
      newValue: { receipt_no: receiptNo, po_number: po.po_number, po_status: nextStatus, lines: input.lines },
    });

    if (rejectedAny || nextStatus === 'partially_received') {
      await notifyAdmins(tx, {
        labId: po.lab_id,
        type: 'receipt_issue',
        title: rejectedAny ? `Rejected or damaged units on ${receiptNo}` : `${po.po_number} partially received`,
        body: `Receipt ${receiptNo} for ${po.po_number}.`,
        link: `/receipts/${receiptId}`,
      });
    }

    return getReceipt(tx, receiptId);
  });
}

export async function getReceipt(db: Db, receiptId: number): Promise<Row> {
  const head = await db.query(
    `SELECT r.id, r.receipt_no, r.po_id, r.lab_id, r.received_at, r.delivery_reference, r.note,
            po.po_number, po.status AS po_status, s.name AS supplier_name, s.address AS supplier_address,
            l.name AS lab_name, l.code AS lab_code, u.name AS received_by_name
     FROM goods_receipts r
     JOIN purchase_orders po ON po.id = r.po_id
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN labs l ON l.id = r.lab_id
     LEFT JOIN users u ON u.id = r.received_by
     WHERE r.id = $1`,
    [receiptId]
  );
  if (head.rows.length === 0) fail(404, 'NOT_FOUND', 'Goods receipt not found.');

  const lines = await db.query(
    `SELECT rl.id, rl.po_item_id, rl.qty_accepted, rl.qty_rejected, rl.reject_reason, rl.note,
            i.description, i.qty_ordered, i.unit_price, p.sku, p.unit, p.id AS product_id
     FROM goods_receipt_lines rl
     JOIN purchase_order_items i ON i.id = rl.po_item_id
     JOIN products p ON p.id = i.product_id
     WHERE rl.receipt_id = $1 ORDER BY rl.id`,
    [receiptId]
  );

  const movements = await db.query(
    `SELECT id, product_id, type, quantity, balance_after, created_at FROM transactions
     WHERE reference_type = 'goods_receipt' AND reference_id = $1 ORDER BY id`,
    [receiptId]
  );

  return {
    ...head.rows[0],
    id: Number(head.rows[0].id),
    po_id: Number(head.rows[0].po_id),
    lab_id: Number(head.rows[0].lab_id),
    lines: lines.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      po_item_id: Number(row.po_item_id),
      product_id: Number(row.product_id),
      qty_accepted: toNumber(row.qty_accepted),
      qty_rejected: toNumber(row.qty_rejected),
      qty_ordered: toNumber(row.qty_ordered),
      unit_price: toNumber(row.unit_price),
    })),
    stock_movements: movements.rows.map((row) => ({ ...row, quantity: toNumber(row.quantity), balance_after: toNumber(row.balance_after) })),
  };
}
