-- Reorder rules, purchase orders, document numbering and the audit log (Prompt 2)

ALTER TABLE labs ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'draft_po'
    CHECK (automation_mode IN ('alert_only', 'draft_po', 'auto_send'));
ALTER TABLE labs ADD COLUMN IF NOT EXISTS auto_approve_limit NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS safety_days INT NOT NULL DEFAULT 3;
UPDATE labs SET code = 'LAB' || id WHERE code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_labs_code ON labs (code);

ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_qty INT CHECK (reorder_qty IS NULL OR reorder_qty > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days INT NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0);

CREATE TABLE IF NOT EXISTS doc_sequences (
    lab_id INT NOT NULL DEFAULT 0,
    doc_type TEXT NOT NULL,
    year INT NOT NULL,
    last_number INT NOT NULL DEFAULT 0,
    PRIMARY KEY (lab_id, doc_type, year)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number TEXT NOT NULL UNIQUE,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    supplier_id INT NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'rejected', 'sent',
        'partially_received', 'received', 'closed', 'cancelled')),
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    approved_by INT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    cancel_reason TEXT,
    close_reason TEXT,
    sent_at TIMESTAMPTZ,
    expected_date DATE,
    supplier_token TEXT NOT NULL UNIQUE,
    supplier_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_lab_status ON purchase_orders (lab_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_status ON purchase_orders (supplier_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    qty_ordered NUMERIC(12,2) NOT NULL CHECK (qty_ordered > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    qty_received NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
    qty_rejected NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
    CHECK (qty_received + qty_rejected <= qty_ordered)
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items (po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items (product_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id INT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    lab_id INT REFERENCES labs(id) ON DELETE SET NULL,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
