-- Goods receipt and verification (Prompt 5)

CREATE TABLE IF NOT EXISTS goods_receipts (
    id SERIAL PRIMARY KEY,
    receipt_no TEXT NOT NULL UNIQUE,
    po_id INT NOT NULL REFERENCES purchase_orders(id),
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    received_by INT REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivery_reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_po ON goods_receipts (po_id);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id SERIAL PRIMARY KEY,
    receipt_id INT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_item_id INT NOT NULL REFERENCES purchase_order_items(id),
    qty_accepted NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),
    qty_rejected NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
    reject_reason TEXT CHECK (reject_reason IS NULL OR reject_reason IN ('damaged', 'short', 'wrong_item', 'other')),
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON goods_receipt_lines (receipt_id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_type TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_id INT;
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions (reference_type, reference_id);
