-- StockSense core schema (Prompt 1)

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    location TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_members (
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (lab_id, user_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    contact_person TEXT NOT NULL DEFAULT '',
    email TEXT,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
    unit TEXT NOT NULL DEFAULT 'units',
    quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reorder_level NUMERIC(12,2) NOT NULL DEFAULT 5,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_lab_sku UNIQUE (lab_id, sku)
);

CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    balance_after NUMERIC(12,2) NOT NULL,
    party TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    lab_ids INTEGER[] NOT NULL DEFAULT '{}',
    invited_by INT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restock_requests (
    id SERIAL PRIMARY KEY,
    lab_id INT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE SET NULL,
    requested_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    urgency TEXT NOT NULL CHECK (urgency IN ('normal', 'urgent')),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')) DEFAULT 'open',
    resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_lab_date ON transactions (lab_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_product ON transactions (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_products_lab_lower_name ON products (lab_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_lab_members_user ON lab_members (user_id);
CREATE INDEX IF NOT EXISTS idx_restock_lab_status ON restock_requests (lab_id, status);
