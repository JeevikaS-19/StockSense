-- Supplier invoices, reports and app settings (Prompts 7 and 8)

CREATE TABLE IF NOT EXISTS supplier_invoices (
    id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL DEFAULT '',
    invoice_date DATE,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    file_data BYTEA,
    original_filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    extraction_source TEXT NOT NULL DEFAULT 'manual' CHECK (extraction_source IN ('gemini', 'mock', 'manual')),
    extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
    comparison JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'accepted', 'disputed')),
    reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    note TEXT NOT NULL DEFAULT '',
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_po ON supplier_invoices (po_id);

CREATE TABLE IF NOT EXISTS reports_log (
    id SERIAL PRIMARY KEY,
    report_no TEXT NOT NULL UNIQUE,
    report_type TEXT NOT NULL,
    lab_id INT REFERENCES labs(id) ON DELETE SET NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by INT REFERENCES users(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (key, value) VALUES ('institution_name', 'REVA University') ON CONFLICT (key) DO NOTHING;
