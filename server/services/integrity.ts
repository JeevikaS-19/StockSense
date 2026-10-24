import type { Db } from '../db.ts';
import { round2, toNumber } from '../errors.ts';

export interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheck[];
}

// Read-only verification of the invariants the app must always keep. Used by `npm run check:integrity`,
// by the demo seed before it reports success, and by the test suite.
export async function runIntegrityChecks(db: Db): Promise<IntegrityReport> {
  const checks: IntegrityCheck[] = [];

  // 1. Product quantity equals the latest ledger balance (zero when there are no movements).
  const quantityMismatch = await db.query(
    `SELECT p.sku, p.quantity, COALESCE(lb.balance_after, 0) AS ledger
     FROM products p
     LEFT JOIN LATERAL (
       SELECT balance_after FROM transactions t WHERE t.product_id = p.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1
     ) lb ON true
     WHERE p.quantity <> COALESCE(lb.balance_after, 0)`
  );
  checks.push({
    name: 'Product quantity matches latest balance_after',
    ok: quantityMismatch.rows.length === 0,
    detail: quantityMismatch.rows.length === 0 ? 'All products reconcile.' : `${quantityMismatch.rows.length} mismatched: ${quantityMismatch.rows.map((r) => r.sku).join(', ')}`,
  });

  // 2. Net commitment per PO matches its status: approved/sent = full value, partially received = outstanding value, otherwise 0.
  const commitMismatch = await db.query(
    `SELECT po.po_number, po.status,
       COALESCE(SUM(CASE WHEN bl.entry_type = 'commit' THEN bl.amount WHEN bl.entry_type = 'release' THEN -bl.amount ELSE 0 END), 0) AS net_commit,
       (SELECT CASE
           WHEN po.status IN ('approved', 'sent') THEN po.total
           WHEN po.status = 'partially_received' THEN COALESCE(SUM((i.qty_ordered - i.qty_received - i.qty_rejected) * i.unit_price), 0)
           ELSE 0 END
        FROM purchase_order_items i WHERE i.po_id = po.id) AS expected_commit
     FROM purchase_orders po
     LEFT JOIN budget_ledger bl ON bl.po_id = po.id
     GROUP BY po.id, po.po_number, po.status, po.total`
  );
  const badCommit = commitMismatch.rows.filter((row) => {
    const expected = row.expected_commit === null ? 0 : round2(toNumber(row.expected_commit));
    return round2(toNumber(row.net_commit)) !== expected;
  });
  checks.push({
    name: 'Committed budget matches each PO status',
    ok: badCommit.length === 0,
    detail: badCommit.length === 0 ? 'All purchase orders reconcile.' : `${badCommit.length} mismatched: ${badCommit.map((r) => r.po_number).join(', ')}`,
  });

  // 3. No negative outstanding quantities on purchase order lines.
  const negativeOutstanding = await db.query(
    'SELECT COUNT(*)::int AS n FROM purchase_order_items WHERE qty_received + qty_rejected > qty_ordered'
  );
  checks.push({
    name: 'No negative outstanding quantities',
    ok: negativeOutstanding.rows[0].n === 0,
    detail: `${negativeOutstanding.rows[0].n} lines over-received.`,
  });

  // 4. Every accepted receipt line is reflected in stock movements tied to that receipt.
  const receiptMismatch = await db.query(
    `SELECT r.receipt_no,
       COALESCE((SELECT SUM(rl.qty_accepted) FROM goods_receipt_lines rl WHERE rl.receipt_id = r.id), 0) AS accepted,
       COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.reference_type = 'goods_receipt' AND t.reference_id = r.id), 0) AS moved
     FROM goods_receipts r`
  );
  const badReceipts = receiptMismatch.rows.filter((row) => round2(toNumber(row.accepted)) !== round2(toNumber(row.moved)));
  checks.push({
    name: 'Goods receipts match stock movements',
    ok: badReceipts.length === 0,
    detail: badReceipts.length === 0 ? 'All receipts reconcile.' : `${badReceipts.length} mismatched receipts.`,
  });

  // 5. Informational: labs over allocation. Approvals over budget are allowed only as audited overrides, so this does not fail the run.
  const overspent = await db.query(
    `SELECT l.code, b.allocated,
       COALESCE((SELECT SUM(CASE WHEN entry_type='commit' THEN amount WHEN entry_type='release' THEN -amount ELSE 0 END) FROM budget_ledger WHERE budget_id = b.id), 0)
       + COALESCE((SELECT SUM(amount) FROM budget_ledger WHERE budget_id = b.id AND entry_type = 'spend'), 0) AS used
     FROM lab_budgets b JOIN labs l ON l.id = b.lab_id WHERE b.is_active = true`
  );
  const overBudget = overspent.rows.filter((row) => toNumber(row.used) > toNumber(row.allocated) + 0.005);
  checks.push({
    name: 'Labs over allocation (informational)',
    ok: true,
    detail: overBudget.length === 0 ? 'No lab is over allocation.' : `Over allocation via audited override: ${overBudget.map((r) => r.code).join(', ')}.`,
  });

  return { ok: checks.every((check) => check.ok), checks };
}
