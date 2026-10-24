# StockSense: project guide

StockSense runs inventory and purchasing for college laboratories and campus stores. Each lab has its own stock, budget and purchase orders. The administrator approves and controls the budget. Staff record stock and raise purchase requests.

Live site: https://stocksense-nine-kappa.vercel.app
Code: https://github.com/JeevikaS-19/StockSense

## Who uses it

| Role | Can do |
| --- | --- |
| Administrator (lab head) | Everything: all labs, approvals, budgets, suppliers, settings, audit log, reports |
| Staff (lab assistant, technician) | Their assigned labs only: record stock, edit products, create and submit orders, receive goods, raise restock requests |

## The main flow

1. **Set up.** The administrator creates labs, sets each lab's budget, adds suppliers, and invites staff with a link tied to their email address.
2. **Add products.** Each product has a SKU, category, unit, unit cost, preferred supplier, reorder point, reorder quantity and lead time.
3. **Record stock.** Stock in and stock out are recorded with a party and an optional note. Stock out can't exceed the stock on hand.
4. **Reorder.** When a stock out takes a product to or below its reorder point, the reorder rules add it to the supplier's draft purchase order, once. Labs can choose alerts only, drafts, or automatic sending under a limit.
5. **Approve.** The draft is submitted and the administrator approves it. Approval checks the budget. If the order is over budget, the administrator can approve only with a written reason, which is recorded.
6. **Send.** Sending marks the order as sent and emails the supplier a link. The supplier can confirm the order and upload an invoice through that link.
7. **Receive.** Goods are received against the order: accepted and rejected quantities with reasons. Over-delivery is blocked. Stock goes up for accepted units only, and the budget is updated. Each receipt gets a number (GRN).
8. **Check the invoice.** An uploaded invoice is read (AI, or typed in by hand) and compared with the order line by line. Invoices never change stock.
9. **Close or cancel.** A partially received order can be closed short, which releases the unreceived budget.
10. **Report.** Reports (stock ledger, purchase register, budget statement, valuation, exceptions) can be printed or exported as CSV. Every report and every change is numbered or logged.

## Features

**Dashboard.** Four numbers (products, need attention, budget left, stock value), a 30-day in and out chart, the latest movements, and a labs list for the administrator.

**Products.** Search, category and low-stock filters, sorting, paging, add and edit with validation, and archive (administrator only). Archiving keeps history.

**Stock in and out.** One form for both directions, with the available stock shown before you record. Recent movements are listed beside it.

**Transactions.** Every movement, filterable by type, product and date. Each receipt movement links to its order and GRN.

**Reorder.** Counts for below reorder point, out of stock and needs a supplier. Inline editing of reorder point, reorder quantity and lead time. Suggested settings based on recent use, with Apply per product or for all. "Generate draft POs" runs the rules on demand.

**Purchase orders.** List with status and supplier filters. A form to create or edit a draft. A detail page with status steps, items with receipt progress, budget impact, receipts, invoice panel, supplier link, and activity. Print as an A4 document.

**Goods receipts (GRN).** A receipt form with a confirmation step, and a printable GRN for each receipt.

**Invoices.** Upload JPG, PNG or PDF. Automatic reading when AI is configured, otherwise manual entry. Line-by-line comparison with flags for quantity and price differences. Accept (administrator) or dispute with a note.

**Budget.** Allocated, committed, spent and available, with a usage bar, burn rate, projected run-out date, and a ledger. Alerts at 75%, 90% and 100%.

**Suppliers.** A shared list with contact details, open orders, and the products each supplier supplies. Only the administrator edits suppliers.

**Restock requests.** Staff ask for stock (optionally for one product). The administrator sees open requests in the bell and resolves them. Staff see their own requests' status.

**Reports.** Five report types. Each has a preview with reconciliation (the stock ledger checks closing quantities against current stock), a printable layout, a CSV download, and a number that is recorded.

**Audit log.** Every change with who made it and the before and after values. Read-only, with filters and CSV export.

**Labs and team.** Create labs, edit them, assign staff, remove staff, invite staff by email link.

**Settings.** Institution name for documents, per-lab automation mode, auto-approve limit and safety days, run automation now, and load demo data.

**Supplier portal.** A public page showing one purchase order, with a confirm button and an invoice upload. Nothing else is visible.

**Automation.** A scheduled job reruns the reorder rules and, in automatic mode, sends drafts under the limit when the budget allows. On Vercel it runs once a day, the most the free plan allows.

**AI assistance.** Invoice reading, reorder suggestion reasons, fit-to-budget explanations, report summaries, and supplier message drafts. Numbers always come from the code. AI only writes the wording, and every AI output is a suggestion someone has to confirm.

## What's built, by prompt

- Core app: login, roles, products, stock in and out, dashboard, transactions, suppliers, lab switcher.
- Team and alerts: invitations, staff alerts, restock requests, notifications, requests page.
- Reorder: rules, draft orders, reorder page, settings.
- Budgets: allocation, ledger, thresholds, budget page.
- Purchase orders: approval, budget checks, overrides, sending, print, supplier link, automation.
- Receiving: receipts, GRN, partial and short close, budget release and spend.
- Demo data: three labs, 39 products, 60 days of history, orders in every state.
- Reports and audit: five reports, print, CSV, audit log.
- AI: invoice reading, suggestions, fit-to-budget, summaries, supplier drafts.
- Hardening: permission checks on every route, no edit or delete for audit and ledger rows, rate-limited sign-in, security headers, production refuses to start without a secret.

## Running it

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `.env`, the app uses an embedded database in `.data/`. Load the demo from Settings, or run `npm run seed:demo`.

Commands: `npm test` (49 API tests on a temporary database), `npm run check:integrity` (stock, budget and receipt checks), `npm run build`, `npm run lint`.

Demo sign-ins: admin `admin@stocksense.dev` / `Admin@123`; staff `arjun@stocksense.dev` and `sneha@stocksense.dev` / `Staff@123`.

## Configuration

See `.env.example`. The important ones are `DATABASE_URL`, `JWT_SECRET` (required in production), `GEMINI_API_KEY` and `GEMINI_MODEL`, `RESEND_API_KEY` and `EMAIL_FROM`, `APP_URL`, and `CRON_SECRET` (on Vercel).

## Known limits

- Email only reaches the account owner's address until a sending domain is verified in Resend.
- AI features run live only with a Gemini key. Without one, invoices are entered by hand and the text features use plain templates.
- Invoice uploads are limited to about 4.5 MB on Vercel.
- The Vercel cron runs daily on the free plan. Every 15 minutes needs Pro.
- Sessions last seven days and can't be revoked before then.
- The demo load takes about two minutes, longer than Vercel's 60-second limit, so run it locally, not on the live site.
- Not yet checked: mobile layouts at phone width, and a full accessibility review.
