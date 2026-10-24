# StockSense — Multi-Lab College Inventory Management System

StockSense is an enterprise-grade web application tailored for college campuses to manage inventory across departmental laboratories (Electronics, Chemistry, Computer Systems, Biotech) and central campus stores. It provides role-based access control, atomic stock transactions with concurrency locking, low-stock threshold monitoring, supplier management, and analytical dashboards.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions incorporate your clarifications and define the implementation strategy before building:

- **Confirmed — Lab Onboarding & Demo Dataset**: On initial admin registration, the system will offer a curated multi-department demo dataset (Electronics Lab, Chemistry Analytical Lab, CS Systems Lab, and Campus Central Store) with representative equipment and chemicals. The admin can immediately configure which labs they manage and explore the platform.
- **Confirmed — PostgreSQL via DATABASE_URL**: The application connects to PostgreSQL (e.g. Supabase, Neon, or self-hosted) via `DATABASE_URL` using the `pg` pool. An npm script `npm run db:setup` will execute `schema.sql` with parameterized tables, indexes, and constraints. When `DATABASE_URL` is pending configuration, a clear, non-blocking configuration banner and resilient fallback mode will guide the administrator without crashing the server.
- **Confirmed — Default Table Pagination Density**: The Products inventory data table will default to 10 products per page, with options to switch to 25 or 50, debounced search, server-side sorting, and category filters.

---

### 1. Overview & Core Concept

StockSense resolves the challenge of decentralized campus inventory tracking where equipment, chemicals, sensors, and consumable components are dispersed across multiple lab buildings.

- **Primary Users**:
  - **Admin (Lab Head / In-Charge)**: Oversees all departmental labs, manages lab creations and member assignments, configures suppliers, monitors cross-lab KPIs, and performs soft-deletions.
  - **Staff (Lab Assistants, Instructors, Technicians)**: Restricted strictly to assigned labs. Enters Stock In/Out movements, creates products, checks inventory levels, and reviews transactions.
- **Key Workflows**:
  1. *Authentication & Invitation*: First user becomes Admin; subsequent staff register via invite tokens or get assigned to specific labs.
  2. *Product Lifecycle*: Products are registered under specific labs with unique SKUs, reorder levels, unit costs, and categories.
  3. *Atomic Stock Movements*: Strict `BEGIN ... SELECT ... FOR UPDATE ... UPDATE ... INSERT ... COMMIT` database transactions prevent race conditions and enforce balance integrity.
  4. *Multi-Lab Analytics*: Recharts-powered 30-day stock movement volume, top issued items, and low-stock/out-of-stock KPI metrics.

---

### 2. User Experience & Visual Design

Following the **SaaS & Dashboard Design Constitution**:
- **Design Philosophy**: Quiet, utilitarian, enterprise clarity. Neutral slate palette (`#0F172A`, `#1E293B`, `#F8FAFC`, `#E2E8F0`), with a single focused Indigo accent (`#4F46E5` / `#6366F1`) used only for primary actions and active navigation states.
- **Status Signal Discipline**: Green (`#16A34A` / `text-emerald-700 bg-emerald-50`) for "In Stock / OK", Amber (`#D97706` / `text-amber-700 bg-amber-50`) for "Low Stock" ($\le \text{reorder\_level}$), and Red (`#DC2626` / `text-rose-700 bg-rose-50`) for "Out of Stock". All statuses pair clean semantic text with accessible color cues (no hue-only communication).
- **Zero-Pill Typography**: Metadata (categories, dates, units) rendered as quiet unboxed text separated by typographic middots (`·`).
- **Tabular Figures**: All counts, prices, quantities, and dates use `font-variant-numeric: tabular-nums` or `font-mono` to prevent layout jitter and align values cleanly.
- **Layout Rhythm**:
  - Left navigation sidebar (collapsible on mobile to drawer) with Lucide icons (`LayoutDashboard`, `Boxes`, `Truck`, `ArrowLeftRight`, `History`, `Settings`).
  - Top bar featuring the contextual Lab Switcher (with quick "Create Lab" modal for Admins, and "All Labs" aggregated view for Admins), and User Profile popover.
  - Generous 16px–24px container padding, 8px corner radii, and crisp 1px borders without heavy shadows or artificial glassmorphism.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Atomic Concurrency Control for Stock In/Out**
  - *Chosen Approach*: Node-postgres client checkout with `BEGIN`, `SELECT ... FOR UPDATE` row-level lock on the target product, balance verification, `UPDATE products SET quantity = ...`, `INSERT INTO transactions ...`, and `COMMIT`.
  - *Why*: Eliminates stock discrepancy race conditions when multiple lab assistants log equipment checkout concurrently.
  - *Error Handling*: Out-of-stock or excessive OUT movements reject immediately with `409 Conflict` (`INSUFFICIENT_STOCK`) with exact available quantity returned.

- **Decision 2: Two-Tier Role-Based Access Control (RBAC)**
  - *Chosen Approach*: JWT with signed `userId` and `role`. A dedicated backend middleware (`requireAuth` + `requireLabAccess`) verifies whether an Admin or an assigned Staff member has access to the requested `lab_id`.
  - *Why*: Security enforcement happens strictly on the backend API layer, preventing unauthorized query injections or URL parameter tampering.

- **Decision 3: Server-Side Pagination, Filtering, and Sorting**
  - *Chosen Approach*: The `/api/products` endpoint handles `lab_id`, `search` (debounced matching against `sku` and `lower(name)`), `category`, `low_stock` boolean, `sort_by`, `order`, `page`, and `limit` (default 10).
  - *Why*: Scalable across thousands of SKUs and chemical reagents without browser memory bottlenecks.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        StockSense Frontend (React)                     │
│  ┌───────────────┐ ┌─────────────────────────────────────────────────┐ │
│  │   Sidebar     │ │ Top Bar: Lab Switcher + User Menu + Alerts      │ │
│  │  · Dashboard  │ └─────────────────────────────────────────────────┘ │
│  │  · Products   │ ┌─────────────────────────────────────────────────┐ │
│  │  · Stock Move │ │  Active View (Router Outlet)                    │ │
│  │  · Transact.  │ │  · KPI Summary Cards (Tabular nums)             │ │
│  │  · Suppliers  │ │  · Recharts 30-Day Flow & Top Issued Bars       │ │
│  │  · Lab Admin  │ │  · Server-Side DataTable & Inline Action Modals │ │
│  └───────────────┘ └─────────────────────────────────────────────────┘ │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ JSON API (Bearer JWT)
┌────────────────────────────────────▼───────────────────────────────────┐
│                      Express REST Server (/api)                        │
│  ┌──────────────────┐ ┌───────────────────┐ ┌────────────────────────┐ │
│  │ Auth Middleware  │ │ Lab Auth Guard    │ │ Zod Request Validator  │ │
│  └────────┬─────────┘ └─────────┬─────────┘ └───────────┬────────────┘ │
│           └─────────────────────┼───────────────────────┘              │
│                                 │ Parameterized Queries                │
│  ┌──────────────┐ ┌─────────────┴──────────┐ ┌───────────────────────┐ │
│  │ /api/auth    │ │ /api/products          │ │ /api/stock/movement   │ │
│  │ /api/labs    │ │ /api/transactions      │ │ /api/dashboard/stats  │ │
│  │ /api/vendors │ │ /api/suppliers         │ │ /api/seed-demo        │ │
│  └──────────────┘ └────────────────────────┘ └───────────────────────┘ │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ pg Pool (FOR UPDATE locks)
┌────────────────────────────────────▼───────────────────────────────────┐
│                         PostgreSQL Database                            │
│  · users (role: admin | staff)        · products (SKU unique per lab)  │
│  · labs (dept, location)              · transactions (IN | OUT audit)  │
│  · lab_members (lab_id, user_id)      · suppliers (shared vendor pool) │
│  · invitations (tokens, lab_ids)      · restock_requests (urgency)     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Database Schema & Indexes (`schema.sql`)
1. `users`: `id SERIAL PRIMARY KEY`, `name TEXT`, `email TEXT UNIQUE`, `password_hash TEXT`, `role TEXT CHECK (role IN ('admin', 'staff'))`, `created_at TIMESTAMPTZ DEFAULT NOW()`
2. `labs`: `id SERIAL PRIMARY KEY`, `name TEXT`, `department TEXT`, `location TEXT`, `created_at TIMESTAMPTZ DEFAULT NOW()`
3. `lab_members`: `lab_id INT REFERENCES labs(id) ON DELETE CASCADE`, `user_id INT REFERENCES users(id) ON DELETE CASCADE`, `PRIMARY KEY (lab_id, user_id)`
4. `suppliers`: `id SERIAL PRIMARY KEY`, `name TEXT`, `contact_person TEXT`, `email TEXT`, `phone TEXT`, `address TEXT`, `created_at TIMESTAMPTZ DEFAULT NOW()`
5. `products`: `id SERIAL PRIMARY KEY`, `lab_id INT REFERENCES labs(id) ON DELETE CASCADE`, `sku TEXT`, `name TEXT`, `description TEXT`, `category TEXT`, `supplier_id INT REFERENCES suppliers(id)`, `unit TEXT`, `quantity NUMERIC(10,2) DEFAULT 0 CHECK (quantity >= 0)`, `reorder_level NUMERIC(10,2) DEFAULT 5`, `unit_price NUMERIC(10,2) DEFAULT 0`, `is_active BOOLEAN DEFAULT TRUE`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`, `UNIQUE (lab_id, sku)`
6. `transactions`: `id SERIAL PRIMARY KEY`, `lab_id INT REFERENCES labs(id)`, `product_id INT REFERENCES products(id)`, `product_name TEXT`, `type TEXT CHECK (type IN ('IN', 'OUT'))`, `quantity NUMERIC(10,2) CHECK (quantity > 0)`, `balance_after NUMERIC(10,2)`, `party TEXT`, `note TEXT`, `user_id INT REFERENCES users(id)`, `created_at TIMESTAMPTZ DEFAULT NOW()`
7. `invitations`: `id SERIAL PRIMARY KEY`, `token TEXT UNIQUE`, `email TEXT`, `lab_ids INT[]`, `invited_by INT REFERENCES users(id)`, `expires_at TIMESTAMPTZ`, `accepted_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT NOW()`
8. `restock_requests`: `id SERIAL PRIMARY KEY`, `lab_id INT REFERENCES labs(id)`, `product_id INT REFERENCES products(id)`, `requested_by INT REFERENCES users(id)`, `message TEXT`, `urgency TEXT CHECK (urgency IN ('normal', 'urgent'))`, `status TEXT CHECK (status IN ('open', 'resolved')) DEFAULT 'open'`, `resolved_by INT REFERENCES users(id)`, `resolved_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT NOW()`
9. **Indexes**:
   - `CREATE INDEX idx_transactions_lab_date ON transactions (lab_id, created_at DESC);`
   - `CREATE INDEX idx_products_lab_lower_name ON products (lab_id, lower(name));`
   - `CREATE INDEX idx_products_sku ON products (lab_id, sku);`

#### Planned Implementation Steps
1. **Server & Database Infrastructure**:
   - Install required packages: `pg`, `@types/pg`, `bcryptjs`, `@types/bcryptjs`, `jsonwebtoken`, `@types/jsonwebtoken`, `zod`, `react-router-dom`, `recharts`.
   - Create `schema.sql` and `npm run db:setup` script.
   - Implement `server.ts` with database connection pooling (`pg.Pool`), parameterized query helpers, robust error wrapper, and graceful connection detection.
2. **Authentication & Authorization API**:
   - `/api/auth/register`: First user is Admin; subsequent users require invite or start as staff; password hashing with `bcryptjs`.
   - `/api/auth/login`: Issue JWT token containing `id`, `name`, `email`, and `role`.
   - `/api/auth/me`: Retrieve current user profile and member labs.
   - Lab access validation middleware.
3. **Core API Routes**:
   - `/api/labs`: CRUD for labs (admin) + list assigned labs (staff).
   - `/api/products`: Search, filter, paginate, sort, add/edit, soft-delete.
   - `/api/stock/movement`: Atomic SQL transaction with `SELECT FOR UPDATE` and concurrency safety.
   - `/api/transactions`: Historical audit log with filtering by product, type, date range.
   - `/api/suppliers`: Manage shared vendor records.
   - `/api/dashboard/stats`: 30-day stock flow, top issued products, KPI metrics.
   - `/api/demo-data`: Endpoint to populate realistic college lab datasets on demand.
4. **Frontend Architecture & Components**:
   - Layout with responsive Left Sidebar + Top Bar with Lab Switcher and Profile.
   - `DataTable` reusable component with pagination (10 items default), sorting, and search debouncing.
   - `StatusChip` for OK (green), Low (amber), Out (red).
   - `KpiCard` with tabular numbers.
   - Dedicated views: Dashboard, Products, Stock In/Out, Transactions, Suppliers, Login/Signup, Lab Management.
5. **Verification & Testing**:
   - TypeScript compilation (`compile_applet`), verification of all API contracts, validation edge cases, and responsive layout checks.
