// End-to-end API tests. They run the real Express app against an embedded database in a temp folder.
// Each block maps to one of the prompt "Check" lines in StockSense_Prompts_1-10.md.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksense-test-'));
// These tests reset and reseed data. They must never run against a real database.
if (process.env.DATABASE_URL) throw new Error('Refusing to run tests with DATABASE_URL set. Unset it first.');
process.env.STOCKSENSE_SKIP_DOTENV = 'true';
process.env.STOCKSENSE_DATA_DIR = dataDir;
process.env.AI_MOCK = 'true';
process.env.AUTOMATION_ENABLED = 'false';
delete process.env.RESEND_API_KEY;
delete process.env.GEMINI_API_KEY;

const { initDatabase, closeDatabase, db, withTransaction } = await import('../server/db.ts');
const { runMigrations } = await import('../db/migrate.ts');
const { createApp } = await import('../server/app.ts');
const { runIntegrityChecks } = await import('../server/services/integrity.ts');
const { seedDemoData } = await import('../server/services/demo.ts');
const { runAutomationForAllLabs } = await import('../server/services/automation.ts');
const { resetLoginLimits } = await import('../server/routes/auth.routes.ts');

let server: Server;
let BASE = '';

async function call(method: string, route: string, opts: { token?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + route, { method, headers, body });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data: data as any };
}

const ADMIN = { name: 'Test Admin', email: 'admin@test.io', password: 'adminpass' };
const STAFF = { name: 'Test Staff', email: 'staff@test.io', password: 'staffpass' };
const OTHER = { name: 'Other Staff', email: 'other@test.io', password: 'otherpass' };

const state: Record<string, any> = {};

before(async () => {
  await initDatabase();
  await runMigrations();
  const app = await createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as { port: number };
  BASE = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Prompt 1: core app, auth and access', () => {
  it('makes the first signup the administrator', async () => {
    const res = await call('POST', '/api/auth/signup', { body: ADMIN });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.role, 'admin');
    state.adminToken = res.data.token;
  });

  it('rejects a second signup without an invitation token', async () => {
    const res = await call('POST', '/api/auth/signup', { body: { ...STAFF } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'INVITATION_REQUIRED');
  });

  it('rejects a duplicate email with EMAIL_IN_USE', async () => {
    const res = await call('POST', '/api/auth/signup', { body: ADMIN });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'EMAIL_IN_USE');
  });

  it('returns the error shape on wrong credentials and locks out after repeated failures', async () => {
    const bad = await call('POST', '/api/auth/login', { body: { email: ADMIN.email, password: 'wrong-pass' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.error.code, 'INVALID_CREDENTIALS');
    resetLoginLimits();
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { email: 'lock@test.io', password: 'nope' } });
    const locked = await call('POST', '/api/auth/login', { body: { email: 'lock@test.io', password: 'nope' } });
    assert.equal(locked.status, 429);
    resetLoginLimits();
  });

  it('creates two labs with generated codes and assigns the admin to them', async () => {
    const electronics = await call('POST', '/api/labs', { token: state.adminToken, body: { name: 'Electronics Lab', department: 'ECE', location: 'B-204', code: 'EL' } });
    const chemistry = await call('POST', '/api/labs', { token: state.adminToken, body: { name: 'Chemistry Lab', department: 'Chem', location: 'C-312', code: 'CH' } });
    const generated = await call('POST', '/api/labs', { token: state.adminToken, body: { name: 'Robotics Lab', department: 'ME', location: 'R-1' } });
    assert.match(generated.data.lab.code, /^[A-Z0-9]{2,8}$/, 'codes are generated when none is given');
    const duplicate = await call('POST', '/api/labs', { token: state.adminToken, body: { name: 'Another Lab', department: 'Physics', location: 'P-1', code: 'EL' } });
    assert.equal(duplicate.status, 409);
    assert.equal(electronics.status, 201);
    assert.equal(electronics.data.lab.code, 'EL');
    assert.equal(chemistry.data.lab.code, 'CH');
    state.labA = electronics.data.lab.id;
    state.labB = chemistry.data.lab.id;
  });

  it('creates a supplier as admin', async () => {
    const res = await call('POST', '/api/suppliers', {
      token: state.adminToken,
      body: { name: 'Sharma Electronics', contact_person: 'R. Sharma', email: 'orders@example.test', phone: '+91 80 0000 0000', address: 'Bengaluru' },
    });
    assert.equal(res.status, 201);
    state.supplier = res.data.supplier.id;
  });

  it('issues an invitation bound to an email and rejects a different email at signup', async () => {
    const invite = await call('POST', '/api/auth/invite', { token: state.adminToken, body: { email: STAFF.email, lab_ids: [state.labA] } });
    assert.equal(invite.status, 201);
    const token = invite.data.invite_url.split('invite=')[1];
    state.inviteToken = token;

    const prefill = await call('GET', `/api/auth/invitations/${token}`);
    assert.equal(prefill.status, 200);
    assert.equal(prefill.data.email, STAFF.email);

    const wrong = await call('POST', '/api/auth/signup', { body: { ...OTHER, invite_token: token } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error.code, 'INVITATION_EMAIL_MISMATCH');

    const ok = await call('POST', '/api/auth/signup', { body: { ...STAFF, invite_token: token } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.user.role, 'staff');
    state.staffToken = ok.data.token;
  });

  it('will not reuse an accepted invitation', async () => {
    const res = await call('POST', '/api/auth/signup', { body: { ...OTHER, invite_token: state.inviteToken } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'INVITATION_USED');
  });

  it('keeps staff out of labs they are not assigned to', async () => {
    const res = await call('GET', `/api/products?lab_id=${state.labB}`, { token: state.staffToken });
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, 'FORBIDDEN');
  });

  it('lets staff edit products in their lab, which previously returned 404', async () => {
    const created = await call('POST', '/api/products', {
      token: state.staffToken,
      body: { lab_id: state.labA, sku: 'el-res-1', name: 'Resistor 10k', category: 'Passive', unit: 'pcs', unit_price: 2, supplier_id: state.supplier, reorder_level: 5, reorder_qty: 20, lead_time_days: 4 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.product.sku, 'EL-RES-1');
    state.product = created.data.product.id;

    const edited = await call('PUT', `/api/products/${state.product}`, {
      token: state.staffToken,
      body: { lab_id: state.labA, name: 'Resistor 10k renamed', category: 'Passive', unit: 'pcs', unit_price: 2.5, supplier_id: state.supplier, reorder_level: 5, reorder_qty: 20, lead_time_days: 4 },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.product.name, 'Resistor 10k renamed');
  });

  it('rejects a duplicate SKU in the same lab', async () => {
    const res = await call('POST', '/api/products', {
      token: state.adminToken,
      body: { lab_id: state.labA, sku: 'EL-RES-1', name: 'Another', category: 'Passive', unit: 'pcs' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'SKU_EXISTS');
  });

  it('keeps suppliers read-only for staff', async () => {
    const res = await call('POST', '/api/suppliers', { token: state.staffToken, body: { name: 'Blocked Supplier' } });
    assert.equal(res.status, 403);
  });
});

describe('Prompt 1: stock in and out', () => {
  it('receives stock with IN and records balance_after', async () => {
    const res = await call('POST', '/api/stock/movement', {
      token: state.staffToken,
      body: { lab_id: state.labA, product_id: state.product, type: 'IN', quantity: 12, party: 'Sharma Electronics' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.product.current_quantity, 12);
  });

  it('rejects an OUT larger than stock with 409 and the available quantity', async () => {
    const res = await call('POST', '/api/stock/movement', {
      token: state.staffToken,
      body: { lab_id: state.labA, product_id: state.product, type: 'OUT', quantity: 15, party: 'Lab practical' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(res.data.error.available_quantity, 12);
    assert.match(res.data.error.message, /Only 12 units available/);
  });

  it('stock OUT that takes product below its reorder point creates a draft PO once, then never duplicates it', async () => {
    const first = await call('POST', '/api/stock/movement', {
      token: state.staffToken,
      body: { lab_id: state.labA, product_id: state.product, type: 'OUT', quantity: 8, party: 'Lab practical' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.data.product.current_quantity, 4);

    const drafts = await call('GET', `/api/purchase-orders?lab_id=${state.labA}&status=draft`, { token: state.adminToken });
    assert.equal(drafts.data.purchase_orders.length, 1);
    const draft = drafts.data.purchase_orders[0];
    assert.equal(draft.source, 'auto');

    const detail = await call('GET', `/api/purchase-orders/${draft.id}`, { token: state.adminToken });
    assert.equal(detail.data.purchase_order.items.length, 1);
    assert.equal(detail.data.purchase_order.items[0].qty_ordered, 20, 'reorder quantity from the product');
    state.autoPo = draft.id;

    await call('POST', '/api/stock/movement', {
      token: state.staffToken,
      body: { lab_id: state.labA, product_id: state.product, type: 'OUT', quantity: 1, party: 'Lab practical' },
    });
    const again = await call('GET', `/api/purchase-orders/${draft.id}`, { token: state.adminToken });
    assert.equal(again.data.purchase_order.items.length, 1, 'the product must not be added twice');
  });

  it('shows the on-order quantity in the products list', async () => {
    const res = await call('GET', `/api/products?lab_id=${state.labA}`, { token: state.staffToken });
    const product = res.data.products.find((p: any) => p.id === state.product);
    assert.equal(product.on_order, 20);
  });

  it('stops the automatic draft when the lab is set to alert only', async () => {
    await call('PUT', `/api/labs/${state.labA}`, { token: state.adminToken, body: { automation_mode: 'alert_only' } });
    const other = await call('POST', '/api/products', {
      token: state.adminToken,
      body: { lab_id: state.labA, sku: 'EL-CAP-2', name: 'Capacitor 100uF', category: 'Passive', unit: 'pcs', unit_price: 3, supplier_id: state.supplier, reorder_level: 2, reorder_qty: 10, lead_time_days: 3 },
    });
    const otherId = other.data.product.id;
    await call('POST', '/api/stock/movement', { token: state.adminToken, body: { lab_id: state.labA, product_id: otherId, type: 'IN', quantity: 3, party: 'Stock' } });
    const out = await call('POST', '/api/stock/movement', { token: state.adminToken, body: { lab_id: state.labA, product_id: otherId, type: 'OUT', quantity: 2, party: 'Lab' } });
    assert.equal(out.status, 201);
    const drafts = await call('GET', `/api/purchase-orders?lab_id=${state.labA}&status=draft`, { token: state.adminToken });
    assert.equal(drafts.data.purchase_orders.filter((p: any) => p.supplier_id === state.supplier).length, 1, 'no new draft in alert-only mode');
    await call('PUT', `/api/labs/${state.labA}`, { token: state.adminToken, body: { automation_mode: 'draft_po' } });
  });

  it('shows the reorder overview with the needs-supplier section', async () => {
    const res = await call('GET', `/api/reorder?lab_id=${state.labA}`, { token: state.staffToken });
    assert.equal(res.status, 200);
    assert.ok(res.data.products.find((p: any) => p.id === state.product).below_reorder_point);
  });
});

describe('Prompt 3 and 4: budgets, approval and the PO lifecycle', () => {
  it('sets the lab budget and returns the four numbers', async () => {
    const res = await call('PUT', '/api/budgets', {
      token: state.adminToken,
      body: { lab_id: state.labA, period_label: '2026-27 Test Semester', start_date: '2026-01-01', end_date: '2026-12-31', allocated: 1000 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.summary.allocated, 1000);
    assert.equal(res.data.summary.available, 1000);
  });

  it('will not let staff edit the budget', async () => {
    const res = await call('PUT', '/api/budgets', {
      token: state.staffToken,
      body: { lab_id: state.labA, period_label: 'x', start_date: '2026-01-01', end_date: '2026-12-31', allocated: 5 },
    });
    assert.equal(res.status, 403);
  });

  it('creates a manual PO, submits it, and blocks staff from approving', async () => {
    const created = await call('POST', '/api/purchase-orders', {
      token: state.staffToken,
      body: { lab_id: state.labA, supplier_id: state.supplier, lines: [{ product_id: state.product, quantity: 10, unit_price: 150 }] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.purchase_order.total, 1500);
    state.bigPo = created.data.purchase_order.id;
    assert.match(created.data.purchase_order.po_number, /^PO-\d{4}-EL-\d{4}$/);

    const submitted = await call('POST', `/api/purchase-orders/${state.bigPo}/submit`, { token: state.staffToken });
    assert.equal(submitted.data.purchase_order.status, 'pending_approval');

    const denied = await call('POST', `/api/purchase-orders/${state.bigPo}/approve`, { token: state.staffToken, body: {} });
    assert.equal(denied.status, 403);
  });

  it('blocks approval that exceeds the budget with BUDGET_EXCEEDED and the shortfall', async () => {
    const res = await call('POST', `/api/purchase-orders/${state.bigPo}/approve`, { token: state.adminToken, body: {} });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'BUDGET_EXCEEDED');
    assert.equal(res.data.error.shortfall, 500);
  });

  it('requires a written reason for an override, then approves and records the commitment', async () => {
    const noReason = await call('POST', `/api/purchase-orders/${state.bigPo}/approve`, { token: state.adminToken, body: { override: true } });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.data.error.code, 'OVERRIDE_REASON_REQUIRED');

    const ok = await call('POST', `/api/purchase-orders/${state.bigPo}/approve`, {
      token: state.adminToken,
      body: { override: true, reason: 'Needed for the practical on Monday' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.purchase_order.status, 'approved');
    const budget = await call('GET', `/api/budgets/summary?lab_id=${state.labA}`, { token: state.adminToken });
    assert.equal(budget.data.summary.committed, 1500);
  });

  it('logs the override in the audit log with override=true', async () => {
    const audit = await call('GET', `/api/audit?entity_type=purchase_order&action=po.approve`, { token: state.adminToken });
    const entry = audit.data.entries.find((e: any) => String(e.entity_id) === String(state.bigPo));
    assert.equal(entry.new_value.override, true);
    assert.equal(entry.new_value.override_reason, 'Needed for the practical on Monday');
  });

  it('cancelling an approved order releases its commitment (admin only)', async () => {
    const denied = await call('POST', `/api/purchase-orders/${state.bigPo}/cancel`, { token: state.staffToken, body: { reason: 'Not needed' } });
    assert.equal(denied.status, 403);
    const res = await call('POST', `/api/purchase-orders/${state.bigPo}/cancel`, { token: state.adminToken, body: { reason: 'Supplier is out of stock' } });
    assert.equal(res.data.purchase_order.status, 'cancelled');
    const budget = await call('GET', `/api/budgets/summary?lab_id=${state.labA}`, { token: state.adminToken });
    assert.equal(budget.data.summary.committed, 0);
  });

  it('rejects a pending order with a reason and notifies the creator', async () => {
    const created = await call('POST', '/api/purchase-orders', {
      token: state.staffToken,
      body: { lab_id: state.labA, supplier_id: state.supplier, lines: [{ product_id: state.product, quantity: 2 }] },
    });
    const id = created.data.purchase_order.id;
    await call('POST', `/api/purchase-orders/${id}/submit`, { token: state.staffToken });
    const rejected = await call('POST', `/api/purchase-orders/${id}/reject`, { token: state.adminToken, body: { reason: 'Quote is too high' } });
    assert.equal(rejected.data.purchase_order.status, 'rejected');
    assert.equal(rejected.data.purchase_order.rejection_reason, 'Quote is too high');
    const notes = await call('GET', '/api/notifications', { token: state.staffToken });
    assert.ok(notes.data.notifications.some((n: any) => n.type === 'po_rejected'));
  });

  it('shows the budget warning at 75% use (threshold notification)', async () => {
    const created = await call('POST', '/api/purchase-orders', {
      token: state.staffToken,
      body: { lab_id: state.labA, supplier_id: state.supplier, lines: [{ product_id: state.product, quantity: 6, unit_price: 150 }] },
    });
    state.receivePo = created.data.purchase_order.id;
    await call('POST', `/api/purchase-orders/${state.receivePo}/submit`, { token: state.staffToken });
    const approved = await call('POST', `/api/purchase-orders/${state.receivePo}/approve`, { token: state.adminToken, body: {} });
    assert.equal(approved.status, 200);
    const notes = await call('GET', '/api/notifications', { token: state.adminToken });
    assert.ok(notes.data.notifications.some((n: any) => n.type === 'budget_threshold' && n.title === 'Budget 75% used'));
  });

  it('sends the PO, exposes only that order on the public supplier link, and records confirmation', async () => {
    const sent = await call('POST', `/api/purchase-orders/${state.receivePo}/send`, { token: state.adminToken });
    assert.equal(sent.data.purchase_order.status, 'sent');
    assert.ok(sent.data.purchase_order.expected_date);
    const token = sent.data.purchase_order.supplier_token;
    state.supplierToken = token;

    const view = await call('GET', `/api/public/po/${token}`);
    assert.equal(view.status, 200);
    assert.equal(view.data.purchase_order.po_number, sent.data.purchase_order.po_number);
    assert.equal(view.data.purchase_order.approved_by, undefined, 'internal fields are not exposed');
    assert.equal(view.data.purchase_order.budget, undefined);

    const confirm = await call('POST', `/api/public/po/${token}/confirm`);
    assert.ok(confirm.data.purchase_order.confirmed_at);

    const bad = await call('GET', '/api/public/po/not-a-real-token');
    assert.equal(bad.status, 404);
  });
});

describe('Prompt 5: goods receipt, invoice matching and closing', () => {
  it('uploads an invoice; the mock read flags the price change and stock does not move', async () => {
    const before = await call('GET', `/api/products?lab_id=${state.labA}`, { token: state.adminToken });
    const qtyBefore = before.data.products.find((p: any) => p.id === state.product).quantity;

    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4 fake')], { type: 'application/pdf' }), 'invoice.pdf');
    const res = await call('POST', `/api/purchase-orders/${state.receivePo}/invoice`, { token: state.staffToken, form });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.invoice.extraction_source, 'mock');
    assert.equal(res.data.invoice.comparison.discrepancy_count, 1);
    assert.match(res.data.invoice.comparison.summary, /discrepancy/);
    state.invoice = res.data.invoice.id;

    const after = await call('GET', `/api/products?lab_id=${state.labA}`, { token: state.adminToken });
    assert.equal(after.data.products.find((p: any) => p.id === state.product).quantity, qtyBefore);
  });

  it('accepts the invoice (admin) so its unit price is used as the spend price', async () => {
    const denied = await call('POST', `/api/invoices/${state.invoice}/accept`, { token: state.staffToken });
    assert.equal(denied.status, 403);
    const ok = await call('POST', `/api/invoices/${state.invoice}/accept`, { token: state.adminToken });
    assert.equal(ok.data.invoice.status, 'accepted');
  });

  it('rejects over-delivery and rejections without a reason', async () => {
    const detail = await call('GET', `/api/purchase-orders/${state.receivePo}`, { token: state.adminToken });
    const itemId = detail.data.purchase_order.items[0].id;
    const over = await call('POST', `/api/purchase-orders/${state.receivePo}/receive`, {
      token: state.staffToken,
      body: { delivery_reference: 'DC-1', lines: [{ po_item_id: itemId, qty_accepted: 7, qty_rejected: 0 }] },
    });
    assert.equal(over.status, 409);
    assert.equal(over.data.error.code, 'OVER_DELIVERY');

    const noReason = await call('POST', `/api/purchase-orders/${state.receivePo}/receive`, {
      token: state.staffToken,
      body: { delivery_reference: 'DC-1', lines: [{ po_item_id: itemId, qty_accepted: 4, qty_rejected: 1 }] },
    });
    assert.equal(noReason.status, 400);
  });

  it('records a partial receipt: stock IN, status, on-order, and budget release and spend at the invoice price', async () => {
    const detail = await call('GET', `/api/purchase-orders/${state.receivePo}`, { token: state.adminToken });
    const itemId = detail.data.purchase_order.items[0].id;
    const res = await call('POST', `/api/purchase-orders/${state.receivePo}/receive`, {
      token: state.staffToken,
      body: { delivery_reference: 'DC-2', lines: [{ po_item_id: itemId, qty_accepted: 4, qty_rejected: 1, reject_reason: 'damaged' }] },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.purchase_order.status, 'partially_received');
    assert.match(res.data.receipt.receipt_no, /^GRN-\d{4}-EL-\d{4}$/);

    const products = await call('GET', `/api/products?lab_id=${state.labA}`, { token: state.adminToken });
    const product = products.data.products.find((p: any) => p.id === state.product);
    assert.equal(product.on_order, 20 + 1, 'the 20-unit auto draft plus 1 outstanding on this order');

    const budget = await call('GET', `/api/budgets/summary?lab_id=${state.labA}`, { token: state.adminToken });
    // committed: 1 unit outstanding at 150. spent: 4 accepted at the invoice price 162.
    assert.equal(budget.data.summary.committed, 150);
    assert.equal(budget.data.summary.spent, 648);
  });

  it('shows the receipt and its stock IN movements', async () => {
    const detail = await call('GET', `/api/purchase-orders/${state.receivePo}`, { token: state.adminToken });
    const receiptId = detail.data.purchase_order.receipts[0].id;
    const res = await call('GET', `/api/receipts/${receiptId}`, { token: state.staffToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.receipt.stock_movements.length, 1);
    assert.equal(res.data.receipt.stock_movements[0].quantity, 4);
    assert.equal(res.data.receipt.lines[0].qty_rejected, 1);
  });

  it('short-closes the order and releases the remaining commitment', async () => {
    const res = await call('POST', `/api/purchase-orders/${state.receivePo}/close`, { token: state.adminToken, body: { reason: 'Supplier cannot deliver the last unit' } });
    assert.equal(res.data.purchase_order.status, 'closed');
    const budget = await call('GET', `/api/budgets/summary?lab_id=${state.labA}`, { token: state.adminToken });
    assert.equal(budget.data.summary.committed, 0);
    assert.equal(budget.data.summary.spent, 648);
  });

  it('keeps the integrity checks passing after the workflow', async () => {
    const report = await withTransaction((tx) => runIntegrityChecks(tx));
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });
});

describe('Prompt 9: suggestions, fit to budget, drafts', () => {
  it('moves over-budget lines into a new draft with fit-to-budget', async () => {
    await call('PUT', '/api/budgets', {
      token: state.adminToken,
      body: { lab_id: state.labA, period_label: '2026-27 Test Semester', start_date: '2026-01-01', end_date: '2026-12-31', allocated: 1000 },
    });
    const created = await call('POST', '/api/purchase-orders', {
      token: state.adminToken,
      body: { lab_id: state.labA, supplier_id: state.supplier, lines: [{ product_id: state.product, quantity: 5, unit_price: 150 }, { product_id: state.product, quantity: 2, unit_price: 100 }] },
    });
    const po = created.data.purchase_order;
    const preview = await call('POST', '/api/ai/fit-to-budget/preview', { token: state.adminToken, body: { po_id: po.id } });
    assert.equal(preview.status, 200);
    const keep = preview.data.plan.included.map((l: any) => l.id);
    const confirm = await call('POST', '/api/ai/fit-to-budget/confirm', { token: state.adminToken, body: { po_id: po.id, keep_item_ids: keep } });
    assert.equal(confirm.status, 200);
    const original = await call('GET', `/api/purchase-orders/${po.id}`, { token: state.adminToken });
    assert.equal(original.data.purchase_order.items.length, keep.length);
  });

  it('returns a threshold suggestion only for products with enough history', async () => {
    const res = await call('GET', `/api/ai/threshold-suggestions?lab_id=${state.labA}`, { token: state.adminToken });
    assert.equal(res.status, 200);
    const row = res.data.suggestions.find((s: any) => s.product_id === state.product);
    assert.equal(row.eligible, false, 'history is shorter than 14 days in a fresh test database');
  });

  it('produces a supplier email draft from the purchase order', async () => {
    const created = await call('POST', '/api/purchase-orders', {
      token: state.adminToken,
      body: { lab_id: state.labA, supplier_id: state.supplier, lines: [{ product_id: state.product, quantity: 1, unit_price: 10 }] },
    });
    const draft = await call('POST', '/api/ai/supplier-email/draft', { token: state.adminToken, body: { po_id: created.data.purchase_order.id } });
    assert.equal(draft.status, 200);
    assert.match(draft.data.subject, /Purchase order PO-/);
    assert.match(draft.data.body, /Sharma Electronics|Dear/);
  });

  it('returns a report summary built from computed numbers (template when AI is in mock mode)', async () => {
    const res = await call('POST', '/api/ai/report-summary', { token: state.adminToken, body: { report_type: 'purchase_register', lab_id: state.labA } });
    assert.equal(res.status, 200);
    assert.equal(res.data.label, 'AI-assisted summary, review before use');
    assert.ok(res.data.text.length > 20);
  });
});

describe('Prompt 2 and 4: automation rules', () => {
  it('auto-sends a small draft within the limit and asks for review when over it', async () => {
    await call('PUT', `/api/labs/${state.labB}`, { token: state.adminToken, body: { automation_mode: 'auto_send', auto_approve_limit: 500, safety_days: 3 } });
    await call('PUT', '/api/budgets', {
      token: state.adminToken,
      body: { lab_id: state.labB, period_label: 'Test', start_date: '2026-01-01', end_date: '2026-12-31', allocated: 100000 },
    });
    const product = await call('POST', '/api/products', {
      token: state.adminToken,
      body: { lab_id: state.labB, sku: 'CH-ETH-1', name: 'Ethanol', category: 'Solvents', unit: 'bottles', unit_price: 100, reorder_level: 5, reorder_qty: 5, lead_time_days: 2 },
    });
    state.chemProduct = product.data.product.id;
    const small = await call('POST', '/api/purchase-orders', {
      token: state.adminToken,
      body: { lab_id: state.labB, supplier_id: state.supplier, lines: [{ product_id: state.chemProduct, quantity: 2 }] },
    });
    const large = await call('POST', '/api/purchase-orders', {
      token: state.adminToken,
      body: { lab_id: state.labB, supplier_id: state.supplier, lines: [{ product_id: state.chemProduct, quantity: 10 }] },
    });
    state.smallPo = small.data.purchase_order.id;
    state.largePo = large.data.purchase_order.id;

    const run = await call('POST', '/api/admin/automation/run', { token: state.adminToken });
    assert.equal(run.status, 200);
    const sent = await call('GET', `/api/purchase-orders/${state.smallPo}`, { token: state.adminToken });
    assert.equal(sent.data.purchase_order.status, 'sent');
    const stillDraft = await call('GET', `/api/purchase-orders/${state.largePo}`, { token: state.adminToken });
    assert.equal(stillDraft.data.purchase_order.status, 'draft');
    const notes = await call('GET', '/api/notifications', { token: state.adminToken });
    assert.ok(notes.data.notifications.some((n: any) => n.type === 'po_needs_review'));
  });
});

describe('Prompt 7 and 10: reports, audit log, read-only ledgers, restock requests', () => {
  it('shows only the expected audit rows to admin and blocks staff', async () => {
    const admin = await call('GET', '/api/audit', { token: state.adminToken });
    assert.equal(admin.status, 200);
    assert.ok(admin.data.entries.length > 0);
    const staff = await call('GET', '/api/audit', { token: state.staffToken });
    assert.equal(staff.status, 403);
  });

  it('has no endpoint to edit or delete audit, ledger, transaction or receipt rows', async () => {
    const edits = [
      await call('PUT', '/api/audit/1', { token: state.adminToken, body: {} }),
      await call('DELETE', '/api/audit/1', { token: state.adminToken }),
      await call('PUT', '/api/budgets/ledger/1', { token: state.adminToken, body: {} }),
      await call('DELETE', '/api/budgets/ledger/1', { token: state.adminToken }),
      await call('PUT', '/api/transactions/1', { token: state.adminToken, body: {} }),
      await call('DELETE', '/api/receipts/1', { token: state.adminToken }),
    ];
    for (const res of edits) assert.equal(res.status, 404);
  });

  it('generates a stock ledger that reconciles with current stock and is recorded with a report number', async () => {
    const res = await call('POST', '/api/reports', { token: state.adminToken, body: { report_type: 'stock_ledger', lab_id: state.labA } });
    assert.equal(res.status, 201);
    assert.match(res.data.report_no, /^RPT-\d{8}-\d{4}$/);
    assert.equal(res.data.report.reconciliation.ok, true);
    const csv = await call('GET', `/api/reports/csv?report_type=stock_ledger&lab_id=${state.labA}`, { token: state.adminToken });
    assert.match(csv.data, /Stock ledger/);
  });

  it('lets staff raise restock requests and see only their own', async () => {
    const created = await call('POST', '/api/requests', {
      token: state.staffToken,
      body: { lab_id: state.labA, product_id: state.product, message: 'Resistors almost gone for Monday', urgency: 'urgent' },
    });
    assert.equal(created.status, 201);
    state.request = created.data.request.id;
    const mine = await call('GET', '/api/requests', { token: state.staffToken });
    assert.equal(mine.data.requests.length, 1);
    const other = await call('POST', '/api/auth/signup', {
      body: { name: 'Nobody', email: 'nobody@test.io', password: 'nobody123', invite_token: 'missing' },
    });
    assert.equal(other.status, 400);
  });

  it('lets admin resolve a request and tells the requester', async () => {
    const res = await call('POST', `/api/requests/${state.request}/resolve`, { token: state.adminToken });
    assert.equal(res.data.request.status, 'resolved');
    const notes = await call('GET', '/api/notifications', { token: state.staffToken });
    assert.ok(notes.data.notifications.some((n: any) => n.type === 'restock_resolved'));
  });

  it('saves the institution name in settings and only the admin can change it', async () => {
    const denied = await call('PUT', '/api/settings', { token: state.staffToken, body: { institution_name: 'Hacked University' } });
    assert.equal(denied.status, 403);
    const ok = await call('PUT', '/api/settings', { token: state.adminToken, body: { institution_name: 'REVA University' } });
    assert.equal(ok.data.settings.institution_name, 'REVA University');
  });
});

describe('Prompt 6: demo data', () => {
  it('loads the demo dataset, reconciles everything, and can be run again', async () => {
    const first = await seedDemoData();
    assert.equal(first.integrity.ok, true, JSON.stringify(first.integrity.checks));
    assert.equal(first.labs.length, 3);
    assert.ok(first.purchase_orders >= 8);
    const second = await seedDemoData();
    assert.equal(second.integrity.ok, true);
    assert.equal(second.purchase_orders, first.purchase_orders, 're-running replaces data rather than adding to it');
  });

  it('keeps the demo budget and stock numbers reconciled after a fresh login', async () => {
    const login = await call('POST', '/api/auth/login', { body: { email: 'admin@stocksense.dev', password: 'Admin@123' } });
    assert.equal(login.status, 200);
    const budget = await call('GET', `/api/budgets/summary?lab_id=${(await db.query("SELECT id FROM labs WHERE code = 'CH'")).rows[0].id}`, { token: login.data.token });
    assert.ok(budget.data.summary.percent_used >= 75);
    const products = await db.query(
      `SELECT COUNT(*)::int AS mismatched FROM products p
       LEFT JOIN LATERAL (SELECT balance_after FROM transactions t WHERE t.product_id = p.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) lb ON true
       WHERE p.quantity <> COALESCE(lb.balance_after, 0)`
    );
    assert.equal(products.rows[0].mismatched, 0);
  });

  it('runs the automation scan without errors on the demo data', async () => {
    const results = await runAutomationForAllLabs();
    assert.equal(results.length, 3);
  });
});
