-- Lab budgets, append-only ledger and notifications (Prompt 3)

CREATE TABLE IF NOT EXISTS lab_budgets (
    id SERIAL PRIMARY KEY,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    period_label TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    allocated NUMERIC(12,2) NOT NULL CHECK (allocated >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_budget_per_lab ON lab_budgets (lab_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS budget_ledger (
    id BIGSERIAL PRIMARY KEY,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    budget_id INT NOT NULL REFERENCES lab_budgets(id) ON DELETE CASCADE,
    po_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('commit', 'release', 'spend', 'adjustment')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL DEFAULT '',
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_budget ON budget_ledger (budget_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_po ON budget_ledger (po_id);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    lab_id INT REFERENCES labs(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
