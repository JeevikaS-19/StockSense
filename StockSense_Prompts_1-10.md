# StockSense: Build Prompts 1 to 10

Paste one prompt at a time into Claude Code (or any coding agent), run the app, check the result, commit, then move on. Each prompt depends on the one before it.

## How to use these with your extracted AI Studio code

1. Put the extracted project in the repo, add the `CLAUDE.md` below, and commit.
2. Run **Prompt 0** first. It compares the existing code with Prompt 1's spec and tells you what is missing.
3. Then do whatever Prompt 0 says is missing from Prompt 1 and 1b (not the whole prompt again if most of it already works).
4. Continue with Prompts 2 to 10 in order.
5. If a prompt produces something broken, fix it with a short follow-up ("the approve endpoint returns 500, here is the error, fix it without changing other behaviour") instead of re-running the whole prompt.

**AI provider note:** Prompts 8 and 9 use Gemini (free key from AI Studio). To use the Anthropic API instead, keep the same prompt and replace "Gemini" with "Claude" and the env var names.

## Run order and target clock (3 hours total)

| # | Prompt | Tier | Target |
|---|--------|------|--------|
| 0 | Audit existing code | Must | 0:00 to 0:10 |
| 1 / 1b | Core app, team and staff alerts | Must | only what is missing |
| 2 | Reorder rules and draft POs | Must | 0:45 to 1:00 |
| 3 | Lab budgets | Must | 1:00 to 1:15 |
| 4 | PO approval, sending, supplier link | Must | 1:15 to 1:35 |
| 5 | Receive goods | Must | 1:35 to 1:55 |
| 6 | Demo data | Must | 1:55 to 2:05 |
| 7 | Reports and audit log | Should | 2:05 to 2:30 |
| 8 | AI invoice scan and three-way match | Should | 2:05 to 2:30 |
| 9 | AI extras | Could | only if ahead |
| 10 | Polish and hardening | Final | 2:30 to 2:45 |

**Parallelising:** Prompts 2 to 6 touch the same tables, so one person runs them in order. After 6 is pushed, 7 and 8 touch different files, so two people can run them on separate branches and merge. If Prompt 6 is not done by about 2:00, skip 8 and 9 and go straight to Prompt 10.

## `CLAUDE.md` (put in the repo root)

```md
# StockSense
Inventory and procurement app for college labs and campus stores.
- Client: React + Vite + Tailwind + React Router + Recharts. Server: Node + Express + pg (PostgreSQL), zod, JWT, bcrypt.
- Server layout: routes/, services/, middleware/, db/migrations/ (numbered .sql files).
- All SQL parameterised. Money is NUMERIC(12,2), shown in INR with Indian grouping.
- Stock quantity changes ONLY in services/stock.js inside a DB transaction with a row lock.
- Roles: admin (lab head) and staff. Enforce permissions and lab membership on the backend.
- Errors: { "error": { "code", "message" } }. Make additive changes, keep existing conventions, run the app after each change.
- Design: slate neutrals, one indigo accent, Inter font, flat surfaces, no gradients, no emojis.
```

---

## Prompt 0: Audit the existing code

```
Read CLAUDE.md and the whole repository. Do not change any code yet.
Produce a short report:
1. How to run the project (install, env vars needed, DB setup, start commands) and whether it currently runs.
2. What exists today versus this spec: PostgreSQL with tables users, labs, lab_members, products, suppliers, transactions, invitations, restock_requests; JWT auth where the first user becomes admin and later signups need an invite token; lab-scoped access enforced on the backend; stock in/out done in a SQL transaction with SELECT ... FOR UPDATE that rejects an OUT larger than stock with 409 INSUFFICIENT_STOCK; pages for Login/Signup, Dashboard (KPIs, 30-day in/out line chart, top 5 issued bar chart, recent transactions, admin "All labs" table), Products (search, category filter, low-stock toggle, pagination, add/edit modal, soft delete), Suppliers, Stock In/Out, Transactions, Labs & Team (invites), and restock requests.
3. A checklist of what is missing or broken, ordered by importance, and the files each fix would touch.
4. Any place where stock quantity is changed outside the stock movement function, or where backend permission checks are missing.
Keep the report under 60 lines.
```

---

## Prompt 1: Core app

```
Build "StockSense", a web app for managing inventory across college labs (multiple departments and domains, for example electronics, chemistry and computer labs) and campus stores.

TECH STACK
- Frontend: React + Tailwind CSS, React Router, Recharts for charts, lucide-react for icons.
- Backend: Node.js + Express REST API under /api, JSON only.
- Database: PostgreSQL using the `pg` library, connection string from the DATABASE_URL environment variable. Provide a schema.sql and an npm script that applies it.
- Auth: email + password, bcrypt hashing, JWT sent as an Authorization: Bearer header. Validate every request body with zod. Use parameterised SQL only. Return errors as { "error": { "code": "...", "message": "..." } }.

ROLES AND ACCESS
- The first user to sign up becomes "admin" (the lab head or in-charge). After that, signup is only possible with a valid invitation token (the invite flow is built in the next step, but accept an optional invite_token on the signup endpoint now). All invited users are "staff" (lab assistants and teachers).
- Admin: access to every lab, can create and edit labs, soft-delete products, and manage users and lab membership.
- Staff: access only to labs they are members of. Can view and add/edit products, record stock movements, and view transactions. Cannot delete products or manage users.
- Enforce this on the backend, not just by hiding buttons.

DATABASE TABLES (PostgreSQL, snake_case)
- users: id, name, email (unique), password_hash, role ('admin' | 'staff'), created_at
- labs: id, name, department, location, created_at
- lab_members: lab_id, user_id (primary key on both)
- products: id, lab_id, sku, name, description, category, supplier_id, unit, quantity (>= 0), reorder_level, unit_price, is_active, created_at, updated_at. SKU is unique within a lab: UNIQUE (lab_id, sku).
- suppliers: id, name, contact_person, email, phone, address (shared across labs)
- transactions: id, lab_id, product_id, product_name, type ('IN' | 'OUT'), quantity (> 0), balance_after, party, note, user_id, created_at
- invitations: id, token (unique), email, lab_ids (integer array), invited_by, expires_at, accepted_at, created_at
- restock_requests: id, lab_id, product_id (nullable), requested_by, message, urgency ('normal' | 'urgent'), status ('open' | 'resolved'), resolved_by, resolved_at, created_at
Create invitations and restock_requests now, but their UI comes in the next step. Add indexes on transactions (lab_id, created_at) and products (lab_id, lower(name)). Do not seed any data yet.

PAGES
Login / Signup, Dashboard, Products, Suppliers, Stock In/Out, Transactions. A lab switcher in the top bar sets the active lab for Products, Stock In/Out and Transactions. Admin can also create and edit labs from the switcher menu.

PRODUCTS PAGE
Table with search (name and SKU, debounced), category filter (options come from categories already used in the active lab, and the add form allows typing a new one), low-stock-only toggle, server-side pagination, sortable columns, add/edit modal with inline field validation, soft delete (sets is_active = false, admin only) with a confirmation dialog. Status chip computed by the server: "ok" (green), "low" (amber) when quantity <= reorder_level, "out" (red) when quantity = 0. Quantity cannot be edited in the product form, only through stock movements.

STOCK IN/OUT
Select product, type (IN or OUT), quantity, party (label it "Supplier" for IN and "Issued to" for OUT), note. Implement the movement with a SQL transaction on the backend: BEGIN, SELECT the product row FOR UPDATE, check stock, UPDATE quantity, INSERT the transaction row with balance_after, COMMIT. If an OUT is larger than the available quantity, return 409 INSUFFICIENT_STOCK and show a clear message such as "Only 4 units available" under the quantity field. Never change quantity anywhere else.

DASHBOARD
- Lab switcher; admin also gets an "All labs" view.
- KPI cards: total products, stock value, low-stock count, out-of-stock count.
- Line chart: stock in vs stock out for the last 30 days (days with no movement show as zero).
- Bar chart: top 5 most issued products in the last 30 days.
- Recent transactions list (latest 8).
- Admin, in "All labs" view: a table with one row per lab (products, stock value, low-stock count, out-of-stock count) that links into that lab.
- Staff only ever see their own labs.

UI AND DESIGN RULES (important)
- Calm, professional, product-grade look. Neutral slate/gray palette, ONE accent color (indigo), used sparingly. Color is reserved for status chips and the chart lines.
- Inter font, tabular numbers in tables and KPI values, sentence-case labels, consistent 8px spacing scale, 8px corner radius.
- Thin 1px borders and flat surfaces. No gradients, no glassmorphism, no heavy drop shadows, no emojis, no decorative illustrations.
- Left sidebar with lucide icons plus a top bar with the lab switcher and the user menu.
- Real copy only, no lorem ipsum or "Welcome back!" fluff. Loading skeletons, helpful empty states with one clear action, toasts for success and errors, confirm dialogs for destructive actions.
- Fully responsive: sidebar becomes a drawer under 768px, tables scroll horizontally on small screens.
- Modular code: separate folders for pages, components, api client, hooks, and server routes/services/middleware. Reusable DataTable, Modal, StatusChip and KpiCard components.
```

**Check:** signup of a second user without an invite token is rejected, and an OUT larger than stock is rejected with a clear message.

---

## Prompt 1b: Team management and staff alerts

```
Add team management and staff-to-admin alerts using the existing invitations, lab_members and restock_requests tables.

1. Labs & Team page (admin only): list labs with member counts and expandable member lists with a "Remove" action. An "Invite staff" form takes an email and one or more labs, creates an invitation (random token, expires in 7 days) and shows the invite link with a Copy button. If SMTP or RESEND_API_KEY environment variables are set, also email the link; otherwise skip the email silently.
2. Signup: when opened with ?invite=<token>, validate the token, prefill and lock the email, create the user as "staff", add them to the invited labs, and mark the invitation accepted. Reject expired, used or invalid tokens with a clear message. Without a token, signup is rejected unless there are no users yet.
3. Staff alerts: on low and out-of-stock rows in Products, and from a "Contact admin" button in the top bar, staff can open a "Request restock" modal with an optional product, a message, and urgency (normal or urgent). Save it to restock_requests.
4. Admin: a bell icon in the top bar with the count of open requests, and a Requests page listing them (filter by lab, urgency, status) with a "Mark resolved" action. Staff see the status of their own requests.
```

---

## Prompt 2: Reorder rules and draft POs

```
Continue building StockSense. Make additive changes only: keep existing conventions (Express routes/services/middleware, zod validation, parameterised pg SQL, snake_case, lab-scoped access checks). Put schema changes in a new numbered migration file and apply it with the existing db script. Money columns are NUMERIC(12,2), displayed in INR with Indian digit grouping (₹1,25,000.00).

GOAL: reorder rules and automatic draft purchase orders.

SCHEMA CHANGES
- labs: add code (short unique text, e.g. "EL"), automation_mode ('alert_only' | 'draft_po' | 'auto_send', default 'draft_po'), auto_approve_limit NUMERIC(12,2) default 0.
- products: reorder_level already exists and is the minimum threshold (label it "Reorder point" in the UI). Add reorder_qty INT (nullable) and lead_time_days INT default 7.
- purchase_orders: id, po_number (unique, format PO-<year>-<lab code>-<4 digit sequence>, e.g. PO-2026-EL-0001), lab_id, supplier_id, status ('draft','pending_approval','approved','rejected','sent','partially_received','received','closed','cancelled'; default 'draft'), total NUMERIC(12,2), notes, source ('manual' | 'auto'), created_by (nullable, null = system), approved_by, approved_at, rejection_reason, sent_at, expected_date, supplier_token (unique random text), supplier_confirmed_at, created_at, updated_at.
- purchase_order_items: id, po_id, product_id, description, qty_ordered (> 0), unit_price, line_total, qty_received default 0.
- doc_sequences: lab_id, doc_type, year, last_number; primary key on the first three. Generate gap-free document numbers inside a transaction with a row lock.
- audit_log (append-only, never updated or deleted): id, actor_id (nullable = system), action, entity_type, entity_id, lab_id, old_value jsonb, new_value jsonb, created_at.

LOGIC
1. Effective stock = on-hand quantity + outstanding quantity on open purchase orders (statuses draft, pending_approval, approved, sent, partially_received; outstanding = qty_ordered - qty_received).
2. Implement scanLabForReorders(labId) in a service. For each active product in the lab where effective stock <= reorder_level, add it to the lab's open DRAFT purchase order for that product's supplier (create one if none exists). Order quantity = reorder_qty, or if null, max(reorder_level * 2 - effective_stock, 1). Unit price = product unit_price. Because the draft counts toward effective stock, a product is never added twice. Recompute PO totals.
3. Call scanLabForReorders for the lab right after every committed stock OUT.
4. Products with no supplier cannot go on a PO: list them as "Needs supplier" on the Reorder page.
5. Respect labs.automation_mode: 'alert_only' creates no POs (only the low-stock list); 'draft_po' and 'auto_send' create drafts (auto-send behaviour comes later, just store the setting now).
6. Write an audit_log row for every PO created, every PO item added, and every change to a product's reorder_level, reorder_qty or lead_time_days (old and new values, actor).

API AND UI
- Product add/edit form: add "Reorder point", "Reorder quantity" and "Lead time (days)" with helper text.
- New "Reorder" page: table of the active lab's products showing on hand, on order, effective stock, reorder point, reorder quantity, lead time, supplier. Inline editing of the three reorder fields (staff and admin can both edit). Filter "Below reorder point". A "Needs supplier" section. A "Generate draft POs" button that runs scanLabForReorders and reports how many items and POs were created or updated.
- Labs settings (admin): edit lab code, automation mode and auto-approve limit, with helper text explaining the three modes.
- Products table: add an "On order" column next to quantity.

Do not build PO approval, budgets or receiving yet.
```

**Check:** record an OUT that takes a product below its reorder point and a draft PO appears with that item. Record another OUT on the same product and no duplicate line appears.

---

## Prompt 3: Lab budgets

```
Continue building StockSense. Additive changes only, same conventions, new migration file.

GOAL: per-lab budget management with committed-spend accounting.

SCHEMA
- lab_budgets: id, lab_id, period_label (e.g. "2026-27 Odd Semester"), start_date, end_date, allocated NUMERIC(12,2), is_active, created_by, created_at. Only one active budget per lab.
- budget_ledger (append-only): id, lab_id, budget_id, po_id (nullable), entry_type ('commit' | 'release' | 'spend' | 'adjustment'), amount NUMERIC(12,2) (always positive), note, created_by (nullable = system), created_at.
- notifications: id, lab_id, user_id (nullable; null = all admins), type, title, body, link, is_read, created_at.

ACCOUNTING RULES (implement as a service, with unit-level SQL, not in the UI)
- committed = sum(commit) - sum(release)
- spent = sum(spend)
- available = allocated - committed - spent
- getBudgetSummary(labId) returns allocated, committed, spent, available, percent_used = (committed + spent) / allocated, burn_rate_per_day (spent over days elapsed in the period) and projected_exhaustion_date (null if burn rate is 0).
- assertBudgetAvailable(labId, amount) returns { ok, available, shortfall }.
- recordLedgerEntry(...) is the only way to insert into budget_ledger, always inside the caller's DB transaction, and it also writes an audit_log row.
- Crossing 75%, 90% and 100% used creates a notification (once per threshold per budget) for admin and for the lab's staff.

UI
- New "Budget" page for the active lab. Cards: Allocated, Committed, Spent, Available. A segmented progress bar (spent, committed, available), the burn rate and projected exhaustion date, and the ledger table (date, type, PO link when present, amount, note, user) with pagination.
- Admin can set or edit the allocation, period label and dates for each lab. Staff see it read-only.
- Dashboard: add a compact budget card (available and percent used) for the active lab, and in the admin "All labs" table add Available budget and percent used columns with an amber/red indicator at 75%/90%.
- Top bar bell: show unread notifications for the current user plus open restock requests for admin. Add a simple notifications dropdown with mark-as-read.

Do not wire budgets into purchase orders yet.
```

**Check:** set a budget and see the four numbers. Insert a commit through a test endpoint or the DB and watch Available drop.

---

## Prompt 4: PO approval, sending and supplier link

```
Continue building StockSense. Additive changes only, same conventions.

GOAL: purchase order workflow with approval, budget checks, sending and automation.

PURCHASE ORDERS PAGES
- "Purchase Orders" page: table with PO number, supplier, lab, status chip, total, created, expected date. Filters: status, supplier, lab (admin can choose all). Status chips use a neutral palette distinct from the stock chips (gray draft, blue pending/approved/sent, teal received, red rejected/cancelled).
- PO detail page: header, status timeline, items table (editable only while draft: change quantity and unit price, add or remove items, supplier fixed), totals, notes, a "Budget impact" panel (available now, this PO total, available after), and an activity list from audit_log for this PO.
- "New PO" manually: pick supplier, add items.

WORKFLOW (enforce on the backend, with row locks so two clicks cannot double-process)
- Submit for approval: draft -> pending_approval (any lab member). Notify admin.
- Approve (admin only): inside one transaction lock the PO and the lab budget, run assertBudgetAvailable. If it passes: status approved, approved_by/at, and recordLedgerEntry('commit', PO total). If it fails: return 409 BUDGET_EXCEEDED with the shortfall and show it clearly. Admin may use "Approve with override", which requires a written reason, is stored in audit_log with a flag override=true, and still records the commit.
- Reject (admin, reason required) -> rejected. Notify creator.
- Cancel (before sent) -> cancelled, and if a commit exists, record a 'release' for the same amount.
- Send to supplier (admin or the approver): status sent, sent_at, expected_date = today + the longest lead time among items. Show a "Supplier link" with Copy button (/supplier/po/<supplier_token>). If RESEND_API_KEY is set, also email the supplier (supplier.email) a short message with that link; otherwise skip silently.

PRINTABLE PO DOCUMENT
- Route /purchase-orders/:id/print: clean A4 print layout (institution name from an app setting, default "REVA University"), PO number, date, lab, supplier details, items table with totals, terms line, and signature blocks. A "Print / Save as PDF" button using window.print() with a print stylesheet (hide nav, page margins, repeat table header).

SUPPLIER LINK (public, no login, token-based)
- /supplier/po/:token shows the PO read-only with a "Confirm order" button that sets supplier_confirmed_at (and an audit_log row). Invalid token shows a plain not-found page. (Invoice upload is added later.)

AUTOMATION
- Add a node-cron job (every 15 minutes, and also a manual "Run automation now" button for admin). For each lab with automation_mode 'auto_send': run scanLabForReorders; then for each draft PO whose total <= labs.auto_approve_limit AND budget is available, perform submit + approve + send as the system actor (actor_id null), logging each step in audit_log. Drafts that do not qualify stay as drafts and notify the lab admin with "Draft PO needs review".
- For 'draft_po' mode, only notify the admin when new draft POs appear.

PERMISSIONS: staff can create/edit drafts and submit; only admin approves, rejects, overrides, and sends. All routes check lab membership.
```

**Check:** create a draft, submit, approve with sufficient budget (Committed rises), then try one that exceeds Available (blocked), then send and open the supplier link.

---

## Prompt 5: Receive goods and verification

```
Continue building StockSense. Additive changes only, same conventions, new migration file.

GOAL: goods receipt with lab verification. Stock changes ONLY when goods are physically received and confirmed by a lab member, never when a PO is sent or an invoice arrives.

SCHEMA
- goods_receipts: id, receipt_no (format GRN-<year>-<lab code>-<4 digit sequence> from doc_sequences), po_id, lab_id, received_by, received_at, delivery_reference (challan or invoice number from the delivery), note.
- goods_receipt_lines: id, receipt_id, po_item_id, qty_accepted, qty_rejected, reject_reason ('damaged' | 'short' | 'wrong_item' | 'other'), note.
- transactions: add reference_type (nullable text) and reference_id (nullable int) so stock movements link back to a PO or receipt.

RECEIVE GOODS SCREEN (on a PO in status sent or partially_received; any lab member)
- Table of lines: item, ordered, previously received, outstanding, "Accepted now" (input, default = outstanding), "Rejected" (input), reason select, note. Validate accepted + rejected <= outstanding (block over-delivery with a clear message). Header fields: delivery reference, received date.
- A "Confirm receipt" button opens a summary dialog (what will be added to stock, what is rejected) before submitting.

BACKEND (one SQL transaction, lock the PO, its items and the affected products)
1. Insert the goods_receipt and lines.
2. For each line with qty_accepted > 0, use the existing stock movement function to insert an IN transaction (party = supplier name, note "Received against <PO number>", reference_type 'goods_receipt', reference_id receipt id) so quantity and balance_after update atomically.
3. Update purchase_order_items.qty_received (accepted + rejected counts as handled; keep two numbers if needed so outstanding is correct).
4. Update PO status: partially_received if any outstanding remains, received if everything is handled.
5. Budget: for the accepted value, recordLedgerEntry('release', accepted_qty * po unit_price) to release the commitment and recordLedgerEntry('spend', accepted_qty * unit_price) to record spend (the price used is the PO price for now; a later step may use the accepted invoice price). Rejected units release their commitment with no spend.
6. audit_log rows for the receipt. If any quantity is rejected or short, notify the admin with the details.
- Admin can "Close PO" (short-close) a partially received PO, which releases the remaining commitment and sets status closed, with a reason.
- Receipts are never edited or deleted. Provide a receipt detail page and a printable GRN (same print style as the PO).

OTHER UI CHANGES
- PO detail: show receipts list with links and a progress bar of received vs ordered.
- Transactions page: show a link badge to the PO or GRN for movements that have a reference.
- Products table: "On order" must now reflect only outstanding quantities.
```

**Check:** send a PO, receive part of it. Stock IN appears, status becomes partially received, Committed falls and Spent rises by the right amounts, and On order shrinks.

---

## Prompt 6: Demo data

```
Continue building StockSense. Additive changes only.

GOAL: a re-runnable demo seed so every screen looks real. Add `npm run seed:demo` and an admin-only "Load demo data" button in Settings (with a confirmation that it replaces existing data). It must truncate and recreate everything and be safe to run repeatedly.

DATA
- Users: admin "Dr. Meera Nair" admin@stocksense.dev / Admin@123; staff "Arjun Rao" arjun@stocksense.dev and "Sneha Iyer" sneha@stocksense.dev, both Staff@123.
- Labs: Electronics Lab (EL), Chemistry Lab (CH), Computer Lab (CS). Arjun is in EL and CS, Sneha in CH.
- 6 suppliers with realistic Indian business names, emails, phones.
- About 40 products across the labs with realistic categories, SKUs, units, unit prices (INR), reorder point, reorder quantity, lead time, supplier. Electronics: Arduino Uno, ESP32, resistor kits, jumper wires, breadboards, multimeters, soldering wire. Chemistry: reagents, beakers, gloves, pH strips. Computer: cables, SSDs, keyboards, toner.
- 60 days of IN and OUT transactions per lab with weekday patterns, fast and slow movers, periodic restocks, consistent balance_after, and final product quantities that match the last balance_after.
- Engineered states: in Electronics, 4 products below their reorder point (one with no draft PO yet), 1 product out of stock, and 1 product with no supplier. Most other items healthy.
- Budgets: Electronics ₹2,00,000 allocated, about 55% used (some committed, some spent). Chemistry ₹80,000 allocated, about 88% used so the 75% alert exists and 90% is close. Computer ₹1,50,000, about 30% used.
- Purchase orders with realistic PO numbers across Electronics: one auto-created draft, one pending approval, one approved-and-sent (supplier confirmed), one partially received (with a goods receipt that has one damaged line), one fully received, one rejected with a reason. Chemistry: one sent PO. Create the matching goods receipts, IN transactions, budget ledger entries (commit, release, spend), audit_log rows and a few notifications so everything reconciles: allocated - committed - spent = available, and product quantity equals the latest balance_after.
- Two open restock requests from staff.

After seeding, verify and print a short reconciliation summary in the console (budget math per lab, stock vs ledger mismatches = 0).
```

**Check:** log in as admin and as staff. Every page should have data, the Electronics lab should show alerts, and Chemistry should show the budget warning.

---

## Prompt 7: Reports and audit log

```
Continue building StockSense. Additive changes only, same conventions, new migration file.

GOAL: audit-friendly reports with print and CSV output, plus an audit log viewer.

SCHEMA: reports_log (id, report_no format RPT-<yyyymmdd>-<4 digit sequence>, report_type, lab_id nullable, params jsonb, generated_by, generated_at). App setting institution_name (default "REVA University", editable by admin).

REPORTS PAGE (/reports)
Controls: report type, lab (admin may pick one lab or all labs; staff only their labs), date range (default = the lab's active budget period). "Generate" opens a preview page. Preview has "Print / Save as PDF" (window.print with an A4 print stylesheet: hide navigation, @page margins, page numbers using CSS counters, repeat table headers, no row split across pages) and "Download CSV" (server-generated, same data).

COMMON FORMAT FOR EVERY REPORT
- Header block: institution name, lab name and code, report title, period, report number, generated by, generated at.
- Right-aligned tabular numbers, INR with Indian grouping, a totals row, sensible column widths.
- Footer: "System-generated report", page X of Y.
- Signature block at the end: Prepared by (auto-filled with the generating user's name), Verified by (blank line), Approved by (blank line).
- Record each generation in reports_log.

REPORTS
1. Stock Ledger: per product, opening quantity (computed from transactions before the period), receipts (IN), issues (OUT), closing quantity and closing value (at unit_price). Show a reconciliation row: when the period ends today, closing quantity must equal current stock, and flag any difference in red.
2. Purchase Register: one row per PO: PO number, date, supplier, status, order value, received value, GRN numbers, invoice number (if attached), with totals. Option to expand lines.
3. Budget Statement: allocated, committed, spent, available, percent used; month-by-month spend table; PO-wise commitments and spend; variance against allocation.
4. Stock Valuation: product, quantity, unit cost, value, subtotal per category, grand total.
5. Exceptions Report: budget overrides (with reasons), cancelled and rejected POs, damaged/short receipts, and any invoice discrepancies (from the audit_log and receipts).

AUDIT LOG PAGE (admin only)
Read-only table of audit_log with filters (date range, user, entity type, action, lab), a before/after viewer for changed values, and CSV export. No edit or delete endpoints may exist for audit_log, budget_ledger, goods_receipts or transactions.

Keep report queries in a dedicated reports service so they are easy to test.
```

**Check:** the Stock Ledger closing quantities match the Products page, and the print preview looks like a document, not a web page.

---

## Prompt 8: AI invoice scan and three-way match (Gemini)

```
Continue building StockSense. Additive changes only, same conventions, new migration file.

GOAL: attach a supplier invoice to a PO, extract it with Gemini, and compare it with the PO. An invoice NEVER changes stock; stock only changes at goods receipt.

SECURITY AND RELIABILITY
- Gemini API key in a server-side env var (GEMINI_API_KEY), never in the client. Model name from an env var.
- AI_MOCK=true env flag returns a canned extraction for the demo. Every live call has a 20 second timeout and falls back to manual entry (the form is shown empty) if it fails, so the user is never blocked.

SCHEMA: supplier_invoices (id, po_id, invoice_number, invoice_date, subtotal, tax, total, file_data or file_path, original_filename, extracted jsonb, comparison jsonb, status ('pending_review' | 'accepted' | 'disputed'), reviewed_by, reviewed_at, note, created_by, created_at).

EXTRACTION
- POST /api/purchase-orders/:id/invoice (multipart: jpg, png, pdf, max 5 MB). Send the file to Gemini with the PO's lines (id, description, quantity, unit_price) in the prompt. Ask for strict JSON only: invoice_number, invoice_date (YYYY-MM-DD), supplier_name, items[{description, quantity, unit_price, line_total, po_item_id (or null), confidence 0-1}], subtotal, tax, total. Instruct the model never to invent items. Parse, validate with zod, and discard any po_item_id that is not on this PO.
- Do the comparison in CODE, not in the model. For each invoice line: 'match', 'qty_differs', 'price_differs' or 'not_on_po'; for each PO line absent from the invoice: 'missing_from_invoice'; plus total difference (invoice total vs PO total). Store the result in comparison.

UI (on the PO detail page, "Supplier invoice" panel; also allow upload from the public supplier link page)
- Upload dropzone with a "Reading invoice..." skeleton state.
- Editable extracted header fields, and a side-by-side comparison table (PO vs invoice: quantity, unit price, line total) with amber flags and a one-line summary such as "2 discrepancies, invoice total ₹3,200 higher than PO".
- Buttons: "Accept invoice" (marks accepted and, from then on, the invoice unit price is used as the spend price for the accepted quantities when goods are received) and "Dispute" (requires a note, notifies admin). Show a clear banner: "Stock updates only when goods are received."
- Receive goods screen: show a banner with any invoice discrepancies for this PO.
- Write audit_log rows for upload, accept and dispute. Discrepancies appear in the Exceptions report.
```

**Check:** upload your sample invoice. Matching lines show green, an altered price or quantity is flagged, and stock numbers do not change.

---

## Prompt 9: AI extras (only if you are ahead)

```
Continue building StockSense. Additive changes only. All AI calls use the Gemini API server-side, support AI_MOCK=true, have a 20 second timeout, and fall back to a template string so the feature still works. Principle: numbers are computed in code and SQL; the model only writes the wording. Every AI output is a suggestion that the user must confirm.

1. THRESHOLD SUGGESTIONS (Reorder page)
For each product with at least 14 days of history: avg_daily_usage = total OUT in the last 30 days / 30; suggested_reorder_point = ceil(avg_daily_usage * (lead_time_days + safety_days)) where safety_days is a lab setting (default 3); suggested_reorder_qty = ceil(avg_daily_usage * 30). Show them in a "Suggested" column next to the current values, with an Apply button per row and "Apply all" (each apply is logged in audit_log). One batched Gemini call returns a one-sentence reason per product using the numbers provided; cache the result for 60 seconds.

2. FIT TO BUDGET (draft PO and the Purchase Orders page)
When a draft PO total exceeds the lab's available budget, show a "Fit to budget" button. In code, rank the lines by urgency (days of stock left, ascending; out of stock first) and greedily select lines that fit within available. Show a preview: "Budget covers 3 of 5 items" with included and excluded lines. On confirm, keep the selected lines on this PO and move the rest into a new draft PO. Gemini writes one short explanation sentence.

3. REPORT SUMMARY
On the Budget Statement and Purchase Register previews, add "Generate summary": a 3 to 4 sentence plain-English summary written from the computed numbers only, shown in an editable text box labelled "AI-assisted summary, review before use", and printed with the report if the user keeps it.

4. SUPPLIER EMAIL DRAFT
On a PO detail page, "Draft message to supplier" returns a subject and body for a polite order message (item list, quantities, delivery date request, institution name). Copy button. If RESEND_API_KEY is set, a "Send" button.
```

---

## Prompt 10: Polish and hardening (always run, even if short)

```
Continue building StockSense. Do not add features. Review and fix the whole application.

1. SECURITY AND PERMISSIONS: audit every endpoint, including all new ones, for authentication, role checks and lab-membership checks (a staff user must never read or change another lab's data by guessing IDs). Confirm only admins can approve, reject, override, send, close POs, edit budgets, view the audit log and manage users. Supplier token pages must expose only that PO.
2. DATA INTEGRITY: confirm stock quantity changes happen only inside the stock movement function; PO approval, cancellation, receipt and budget ledger writes use SQL transactions with row locks; budget_ledger, audit_log, transactions and goods_receipts have no update or delete endpoints. Add a script `npm run check:integrity` that verifies: product quantity equals the latest balance_after, committed and spent match the ledger, no PO outstanding quantity is negative.
3. UX: every table has loading skeletons and a useful empty state; every action button disables while submitting; errors show human messages from the API error shape; money is formatted ₹ with Indian grouping everywhere; dates are readable; keyboard focus and Esc on modals work; the layout is clean at 375px, 768px and 1280px.
4. CLEANUP: remove dead code, unused components and console logs; make sure there are no console errors on any page.
5. DOCS: write README.md (what the app is, features, tech stack, setup, env vars, seed command, demo credentials) and docs/ARCHITECTURE.md with a Mermaid architecture diagram, a Mermaid ER diagram of all tables, and the procurement workflow (reorder, PO, approval, send, invoice, receipt, budget, reports).
6. Finally, walk through this demo path and fix anything that breaks: log in as admin; see low-stock alerts; open a draft PO; approve it (budget check); send it; open the supplier link and confirm; upload the invoice; receive the goods; see stock and budget update; open the Stock Ledger and Budget Statement; print to PDF.
```

---

## Session tips

- **Commit after every prompt** so a bad generation can be reverted instead of debugged.
- **Before the demo:** run the Prompt 6 seed on the deployed instance and set `AI_MOCK=true` as the safety net for the invoice step.
- **Prepare the sample invoice now:** a simple PDF with a supplier name from the seed, 4 to 5 lines matching a seeded sent PO, and one line with a slightly different price, so the discrepancy flag shows in the demo.
- **Demo credentials (from Prompt 6):** `admin@stocksense.dev / Admin@123`, `arjun@stocksense.dev / Staff@123`, `sneha@stocksense.dev / Staff@123`.
