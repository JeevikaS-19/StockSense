# StockSense

Inventory and procurement for college laboratories and campus stores. Each lab keeps its own stock, budget and purchase orders. Staff record movements and raise requests. The administrator approves orders, controls the budget and reviews reports.

## Features

- **Stock**: products per lab with SKU, categories, search and filters. Stock in and out is recorded in a single transaction with row locking, and an OUT larger than the stock on hand is refused with the available quantity shown.
- **Reorder rules**: each product has a reorder point, order quantity and lead time. A stock out that crosses the reorder point adds the product to the supplier's draft purchase order, once. Labs choose alerts only, draft orders, or automatic sending under a limit.
- **Purchase orders**: draft, submit, approve, send, receive, close or cancel. Approval checks the lab budget and can be overridden only with a written reason, which is audited. Each order has a printable A4 document and a public link for the supplier to confirm and send an invoice.
- **Goods receipt**: accepted and rejected quantities per line, with reasons. Over-delivery is blocked. Each receipt is numbered (GRN) and is never edited.
- **Invoices**: upload a JPG, PNG or PDF. AI reads it when a Gemini key is set, otherwise it is entered by hand. Lines are compared with the order in code, and an invoice never changes stock.
- **Budgets**: allocated, committed, spent and available, with burn rate, projected exhaustion, and alerts at 75%, 90% and 100%.
- **Reports**: stock ledger (reconciled with current stock), purchase register, budget statement, stock valuation and exceptions, each printable, exportable as CSV, and numbered.
- **Audit log**: every change with before and after values. Read-only.
- **Roles**: the administrator (lab head) sees all labs and approves. Staff see only their assigned labs and can draft, submit, receive and raise requests.

## Run it

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev          # http://localhost:3000
```

No database setup is needed. Without `DATABASE_URL` the app uses an embedded PostgreSQL (PGlite) stored in `.data/`. To use your own PostgreSQL, set `DATABASE_URL` in `.env` and run `npm run db:setup`.

Load the demo data from **Settings > Load demo data**, or run `npm run seed:demo` in a terminal. The demo is three labs (Electronics, Chemistry, Computer), 39 products, 60 days of history, and purchase orders in every state.

| Role | Email | Password |
| --- | --- | --- |
| Administrator | admin@stocksense.dev | Admin@123 |
| Staff (Electronics, Computer) | arjun@stocksense.dev | Staff@123 |
| Staff (Chemistry) | sneha@stocksense.dev | Staff@123 |

## Configuration

Copy `.env.example` to `.env`. Every setting is optional for local use. See the file for each variable. The important ones:

- `JWT_SECRET`: required when `NODE_ENV=production`. The server will not start without it.
- `DATABASE_URL`: PostgreSQL. If it cannot be reached, the app falls back to the embedded database and says so in the log.
- `GEMINI_API_KEY` / `AI_MOCK`: invoice reading and drafted text. With neither, the app asks for manual entry.
- `RESEND_API_KEY`: sends invitations and supplier emails. Without it, the links are shown in the app instead.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the server with the React app (Vite) |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Starts the server (use `NODE_ENV=production` after a build) |
| `npm run db:setup` | Applies the database migrations |
| `npm run seed:demo` | Replaces all data with the demo dataset and checks it |
| `npm run check:integrity` | Read-only check: stock matches the ledger, commitments match PO status, receipts match stock |
| `npm test` | Runs the API test suite against a temporary database |
| `npm run lint` | Type-checks the project |

## Project layout

```
server.ts                 Entry point: database, migrations, cron, web server
server/app.ts             Express app and error handling
server/routes/            HTTP routes, one file per area
server/services/          Business rules (stock, budget, purchase orders, receiving, reorder, reports...)
server/middleware/        Authentication, lab access checks, validation
db/migrations/            Numbered SQL migrations
src/                      React app (pages, components, API client, contexts)
scripts/                  Command-line tools (setup, demo, integrity check)
tests/api.test.ts         API tests, one block per prompt check
docs/ARCHITECTURE.md      Diagrams: components, data model, procurement workflow
```

## Design rules

- Stock quantities change only through `applyStockMovement` (`server/services/stock.ts`), inside a transaction with a row lock.
- Budget entries are written only through `recordLedgerEntry`, which also writes the audit row and sends threshold alerts.
- Document numbers (PO, GRN, report) come from a gap-free sequence inside the same transaction.
- Permissions are enforced on the server. The interface only hides what the server would refuse anyway.
- Money is shown in rupees with Indian grouping (for example ₹1,25,000.00).

## Limits of this prototype

- Email is sent through Resend only. SMTP is not supported.
- AI features need a Gemini key to run live. With `AI_MOCK=true` they return fixed, clearly-labelled results.
- Sessions use a token in browser storage with a seven-day lifetime. Put the app behind HTTPS before real use.
- The embedded database is a single-process store. For several users on one server, use PostgreSQL through `DATABASE_URL`.
