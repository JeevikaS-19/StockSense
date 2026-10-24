# StockSense architecture

## Components

```mermaid
flowchart LR
  subgraph Browser
    UI[React pages] --> API[API client]
    UI --> Ctx[Auth and lab contexts]
  end
  subgraph Server[Express server]
    Routes[routes/*] --> MW[auth, lab access, validation]
    Routes --> Svc[services/*]
    Svc --> Stock[stock: the only quantity writer]
    Svc --> Budget[budget ledger]
    Svc --> PO[purchase orders]
    Svc --> Reorder[reorder rules]
    Svc --> Ai[AI, optional]
    Svc --> Mail[email, optional]
    Cron[15-minute automation] --> Svc
  end
  subgraph Data
    DB[(PostgreSQL or embedded PGlite)]
  end
  API -- JSON over HTTPS, Bearer token --> Routes
  Svc --> DB
```

Every route checks the caller's role and lab membership on the server. Every write that changes money or stock runs in a transaction that also writes an audit row.

## Data model

```mermaid
erDiagram
  USERS ||--o{ LAB_MEMBERS : "is assigned"
  LABS ||--o{ LAB_MEMBERS : has
  LABS ||--o{ PRODUCTS : holds
  SUPPLIERS ||--o{ PRODUCTS : "preferred for"
  PRODUCTS ||--o{ TRANSACTIONS : "moves"
  SUPPLIERS ||--o{ PURCHASE_ORDERS : receives
  LABS ||--o{ PURCHASE_ORDERS : raises
  PURCHASE_ORDERS ||--|{ PURCHASE_ORDER_ITEMS : contains
  PURCHASE_ORDERS ||--o{ GOODS_RECEIPTS : "received as"
  GOODS_RECEIPTS ||--|{ GOODS_RECEIPT_LINES : lists
  GOODS_RECEIPT_LINES }o--|| PURCHASE_ORDER_ITEMS : "for"
  PURCHASE_ORDERS ||--o{ SUPPLIER_INVOICES : "billed by"
  LABS ||--o{ LAB_BUDGETS : allocates
  LAB_BUDGETS ||--o{ BUDGET_LEDGER : records
  PURCHASE_ORDERS ||--o{ BUDGET_LEDGER : "commits and spends"
  LABS ||--o{ RESTOCK_REQUESTS : receives
  USERS ||--o{ NOTIFICATIONS : gets
  USERS ||--o{ AUDIT_LOG : "acts in"
  LABS ||--o{ REPORTS_LOG : generates
  INVITATIONS }o--|| USERS : "invited by"
```

`transactions`, `budget_ledger`, `goods_receipts` and `audit_log` are append-only. The application has no endpoint that updates or deletes them.

## Procurement workflow

```mermaid
flowchart TD
  Stock[Stock out crosses reorder point] --> Scan[Reorder scan]
  Scan -->|supplier set| Draft[Draft PO for supplier]
  Scan -->|no supplier| NeedsSupplier[Listed as needs supplier]
  Manual[Staff creates a draft] --> Draft
  Draft --> Submit[Submit for approval]
  Submit --> Approve{Admin approves}
  Approve -->|within budget| Commit[Commit amount in budget]
  Approve -->|over budget| Override{Written override reason?}
  Override -->|yes, audited| Commit
  Override -->|no| Blocked[409 BUDGET_EXCEEDED]
  Approve -->|reject| Rejected[Rejected, creator told why]
  Commit --> Send[Send to supplier and email link]
  Send --> Confirm[Supplier confirms on public link]
  Send --> Invoice[Invoice uploaded: read by AI or entered, compared in code]
  Send --> Receive[Goods received]
  Receive --> Stock2[Stock IN, release commitment, record spend]
  Receive --> Partial{All delivered?}
  Partial -->|no| Partially[Partially received]
  Partially --> Close[Admin closes short: release the rest]
  Partial -->|yes| Received[Received]
```

Stock changes only at receipt, never at send or invoice time.

## Background jobs

A cron job runs every 15 minutes (`server/services/automation.ts`). For each lab it runs the reorder scan, and in automatic mode it submits, approves and sends drafts under the lab's limit when the budget allows. Anything else is left as a draft and an administrator is notified. The administrator can run the same job from Settings.
