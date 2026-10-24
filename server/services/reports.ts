import type { Db, Row } from '../db.ts';
import { round2, toNumber } from '../errors.ts';
import { todayIso } from './budget.ts';

export const REPORT_TYPES = ['stock_ledger', 'purchase_register', 'budget_statement', 'stock_valuation', 'exceptions'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TITLES: Record<ReportType, string> = {
  stock_ledger: 'Stock Ledger',
  purchase_register: 'Purchase Register',
  budget_statement: 'Budget Statement',
  stock_valuation: 'Stock Valuation',
  exceptions: 'Exceptions Report',
};

export interface Column {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money';
}

export interface Section {
  title: string;
  columns: Column[];
  rows: Row[];
  totals: Row | null;
  note?: string;
}

export interface ReportData {
  type: ReportType;
  title: string;
  period: { from: string; to: string };
  lab: { id: number; name: string; code: string } | null;
  sections: Section[];
  notes: string[];
  reconciliation: { ok: boolean; mismatches: number } | null;
}

export interface ReportRequest {
  type: ReportType;
  labIds: number[] | null; // null = every lab in scope
  singleLab: { id: number; name: string; code: string } | null;
  from?: string;
  to?: string;
}

// Default period: the active budget period if the lab has one, otherwise the current month.
async function resolvePeriod(db: Db, req: ReportRequest): Promise<{ from: string; to: string }> {
  const today = await todayIso(db);
  if (req.from && req.to) return { from: req.from, to: req.to };
  if (req.singleLab) {
    const budget = await db.query(
      'SELECT start_date::text AS start_date, end_date::text AS end_date FROM lab_budgets WHERE lab_id = $1 AND is_active = true',
      [req.singleLab.id]
    );
    if (budget.rows[0]) return { from: budget.rows[0].start_date, to: budget.rows[0].end_date > today ? today : budget.rows[0].end_date };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function money(value: unknown): number {
  return round2(toNumber(value));
}

async function stockLedger(db: Db, req: ReportRequest, period: { from: string; to: string }, today: string): Promise<Section> {
  const res = await db.query(
    `SELECT p.id, l.code AS lab_code, p.sku, p.name, p.unit, p.unit_price, p.quantity AS current_quantity, p.is_active,
       COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.quantity ELSE -t.quantity END) FILTER (WHERE t.created_at::date < $2::date), 0) AS opening,
       COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'IN' AND t.created_at::date BETWEEN $2::date AND $3::date), 0) AS receipts,
       COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'OUT' AND t.created_at::date BETWEEN $2::date AND $3::date), 0) AS issues
     FROM products p
     JOIN labs l ON l.id = p.lab_id
     LEFT JOIN transactions t ON t.product_id = p.id
     WHERE ($1::int[] IS NULL OR p.lab_id = ANY($1::int[]))
     GROUP BY p.id, l.code
     ORDER BY l.code, p.sku`,
    [req.labIds, period.from, period.to]
  );

  const reconcileToday = period.to >= today;
  let mismatches = 0;
  const rows = res.rows.map((row) => {
    const opening = round2(toNumber(row.opening));
    const receipts = round2(toNumber(row.receipts));
    const issues = round2(toNumber(row.issues));
    const closing = round2(opening + receipts - issues);
    const current = round2(toNumber(row.current_quantity));
    const difference = reconcileToday ? round2(closing - current) : 0;
    if (difference !== 0) mismatches++;
    const unitPrice = money(row.unit_price);
    return {
      lab: row.lab_code,
      sku: row.sku,
      product: row.is_active ? row.name : `${row.name} (archived)`,
      unit: row.unit,
      opening,
      receipts,
      issues,
      closing,
      unit_price: unitPrice,
      closing_value: round2(closing * unitPrice),
      current_stock: current,
      difference,
    };
  });

  return {
    title: 'Stock ledger',
    columns: [
      { key: 'lab', label: 'Lab', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'opening', label: 'Opening', type: 'number' },
      { key: 'receipts', label: 'Receipts', type: 'number' },
      { key: 'issues', label: 'Issues', type: 'number' },
      { key: 'closing', label: 'Closing', type: 'number' },
      { key: 'unit_price', label: 'Unit cost', type: 'money' },
      { key: 'closing_value', label: 'Closing value', type: 'money' },
      { key: 'current_stock', label: 'Current stock', type: 'number' },
      { key: 'difference', label: 'Difference', type: 'number' },
    ],
    rows,
    totals: {
      lab: 'Total',
      closing_value: round2(rows.reduce((sum, row) => sum + row.closing_value, 0)),
      difference: mismatches,
    },
    note: reconcileToday
      ? `Closing quantity is checked against current stock. ${mismatches} difference${mismatches === 1 ? '' : 's'} found.`
      : 'The period ends before today, so closing quantities are not checked against current stock.',
  };
}

async function purchaseRegister(db: Db, req: ReportRequest, period: { from: string; to: string }): Promise<Section> {
  const res = await db.query(
    `SELECT po.id, po.po_number, po.created_at::date::text AS date, s.name AS supplier, po.status, po.total AS order_value,
       COALESCE((SELECT SUM(i.qty_received * i.unit_price) FROM purchase_order_items i WHERE i.po_id = po.id), 0) AS received_value,
       COALESCE((SELECT string_agg(r.receipt_no, ', ' ORDER BY r.id) FROM goods_receipts r WHERE r.po_id = po.id), '') AS grns,
       COALESCE((SELECT si.invoice_number FROM supplier_invoices si WHERE si.po_id = po.id ORDER BY si.id DESC LIMIT 1), '') AS invoice_number,
       l.code AS lab_code
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN labs l ON l.id = po.lab_id
     WHERE ($1::int[] IS NULL OR po.lab_id = ANY($1::int[]))
       AND po.created_at::date BETWEEN $2::date AND $3::date
     ORDER BY po.created_at, po.id`,
    [req.labIds, period.from, period.to]
  );

  const lineRes = await db.query(
    `SELECT i.po_id, i.description, i.qty_ordered, i.unit_price, i.line_total, i.qty_received, i.qty_rejected
     FROM purchase_order_items i WHERE i.po_id = ANY($1::int[]) ORDER BY i.id`,
    [res.rows.map((row) => Number(row.id))]
  );

  const rows = res.rows.map((row) => ({
    lab: row.lab_code,
    po_number: row.po_number,
    date: row.date,
    supplier: row.supplier,
    status: row.status.replace(/_/g, ' '),
    order_value: money(row.order_value),
    received_value: money(row.received_value),
    grns: row.grns,
    invoice_number: row.invoice_number,
    lines: lineRes.rows
      .filter((line) => Number(line.po_id) === Number(row.id))
      .map((line) => ({
        description: line.description,
        ordered: toNumber(line.qty_ordered),
        received: toNumber(line.qty_received),
        rejected: toNumber(line.qty_rejected),
        unit_price: money(line.unit_price),
        line_total: money(line.line_total),
      })),
  }));

  return {
    title: 'Purchases',
    columns: [
      { key: 'lab', label: 'Lab', type: 'text' },
      { key: 'po_number', label: 'PO number', type: 'text' },
      { key: 'date', label: 'Date', type: 'text' },
      { key: 'supplier', label: 'Supplier', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'order_value', label: 'Order value', type: 'money' },
      { key: 'received_value', label: 'Received value', type: 'money' },
      { key: 'grns', label: 'GRN numbers', type: 'text' },
      { key: 'invoice_number', label: 'Invoice no.', type: 'text' },
    ],
    rows,
    totals: {
      lab: 'Total',
      order_value: round2(rows.reduce((sum, row) => sum + row.order_value, 0)),
      received_value: round2(rows.reduce((sum, row) => sum + row.received_value, 0)),
    },
  };
}

async function budgetStatement(db: Db, req: ReportRequest, period: { from: string; to: string }): Promise<Section[]> {
  const budgets = await db.query(
    `SELECT b.id, b.lab_id, b.period_label, b.allocated, b.start_date::text AS start_date, b.end_date::text AS end_date, l.name AS lab_name, l.code AS lab_code
     FROM lab_budgets b JOIN labs l ON l.id = b.lab_id
     WHERE b.is_active = true AND ($1::int[] IS NULL OR b.lab_id = ANY($1::int[]))
     ORDER BY l.code`,
    [req.labIds]
  );

  const summaryRows: Row[] = [];
  for (const budget of budgets.rows) {
    const totals = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'commit' THEN amount WHEN entry_type = 'release' THEN -amount ELSE 0 END), 0) AS committed,
              COALESCE(SUM(CASE WHEN entry_type = 'spend' THEN amount ELSE 0 END), 0) AS spent
       FROM budget_ledger WHERE budget_id = $1`,
      [budget.id]
    );
    const allocated = money(budget.allocated);
    const committed = money(totals.rows[0].committed);
    const spent = money(totals.rows[0].spent);
    const used = round2(committed + spent);
    summaryRows.push({
      lab: budget.lab_code,
      period: budget.period_label,
      allocated,
      committed,
      spent,
      available: round2(allocated - used),
      percent_used: allocated > 0 ? Math.round((used / allocated) * 1000) / 10 : 0,
      variance: round2(allocated - used),
    });
  }

  const monthly = await db.query(
    `SELECT to_char(bl.created_at, 'YYYY-MM') AS month, l.code AS lab_code, COALESCE(SUM(bl.amount), 0) AS spend
     FROM budget_ledger bl JOIN labs l ON l.id = bl.lab_id
     WHERE bl.entry_type = 'spend' AND ($1::int[] IS NULL OR bl.lab_id = ANY($1::int[]))
       AND bl.created_at::date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [req.labIds, period.from, period.to]
  );

  const poWise = await db.query(
    `SELECT po.po_number, po.status, l.code AS lab_code,
       COALESCE(SUM(CASE WHEN bl.entry_type = 'commit' THEN bl.amount WHEN bl.entry_type = 'release' THEN -bl.amount ELSE 0 END), 0) AS committed,
       COALESCE(SUM(CASE WHEN bl.entry_type = 'spend' THEN bl.amount ELSE 0 END), 0) AS spent
     FROM budget_ledger bl JOIN purchase_orders po ON po.id = bl.po_id JOIN labs l ON l.id = po.lab_id
     WHERE ($1::int[] IS NULL OR bl.lab_id = ANY($1::int[]))
     GROUP BY po.id, po.po_number, po.status, l.code
     ORDER BY l.code, po.po_number`,
    [req.labIds]
  );

  return [
    {
      title: 'Allocation and position',
      columns: [
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'allocated', label: 'Allocated', type: 'money' },
        { key: 'committed', label: 'Committed', type: 'money' },
        { key: 'spent', label: 'Spent', type: 'money' },
        { key: 'available', label: 'Available', type: 'money' },
        { key: 'percent_used', label: '% used', type: 'number' },
        { key: 'variance', label: 'Unused allocation', type: 'money' },
      ],
      rows: summaryRows,
      totals: null,
    },
    {
      title: 'Monthly spend',
      columns: [
        { key: 'month', label: 'Month', type: 'text' },
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'spend', label: 'Spend', type: 'money' },
      ],
      rows: monthly.rows.map((row) => ({ month: row.month, lab: row.lab_code, spend: money(row.spend) })),
      totals: { month: 'Total', spend: round2(monthly.rows.reduce((sum, row) => sum + toNumber(row.spend), 0)) },
    },
    {
      title: 'Commitments and spend by purchase order',
      columns: [
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'po_number', label: 'PO number', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'committed', label: 'Committed', type: 'money' },
        { key: 'spent', label: 'Spent', type: 'money' },
      ],
      rows: poWise.rows.map((row) => ({
        lab: row.lab_code,
        po_number: row.po_number,
        status: row.status.replace(/_/g, ' '),
        committed: money(row.committed),
        spent: money(row.spent),
      })),
      totals: null,
    },
  ];
}

async function stockValuation(db: Db, req: ReportRequest): Promise<Section> {
  const res = await db.query(
    `SELECT p.category, p.sku, p.name, p.unit, p.quantity, p.unit_price, l.code AS lab_code
     FROM products p JOIN labs l ON l.id = p.lab_id
     WHERE p.is_active = true AND ($1::int[] IS NULL OR p.lab_id = ANY($1::int[]))
     ORDER BY p.category, p.sku`,
    [req.labIds]
  );

  const rows: Row[] = [];
  let currentCategory: string | null = null;
  let subtotal = 0;
  let grand = 0;
  const flush = () => {
    if (currentCategory !== null) {
      rows.push({ category: `${currentCategory} subtotal`, subtotal: true, value: round2(subtotal) });
    }
  };
  for (const row of res.rows) {
    if (row.category !== currentCategory) {
      flush();
      currentCategory = row.category;
      subtotal = 0;
    }
    const quantity = round2(toNumber(row.quantity));
    const unitPrice = money(row.unit_price);
    const value = round2(quantity * unitPrice);
    subtotal += value;
    grand += value;
    rows.push({ category: row.category, lab: row.lab_code, sku: row.sku, product: row.name, unit: row.unit, quantity, unit_price: unitPrice, value, subtotal: false });
  }
  flush();

  return {
    title: 'Valuation by category',
    columns: [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'lab', label: 'Lab', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unit_price', label: 'Unit cost', type: 'money' },
      { key: 'value', label: 'Value', type: 'money' },
    ],
    rows,
    totals: { category: 'Grand total', value: round2(grand) },
  };
}

async function exceptions(db: Db, req: ReportRequest, period: { from: string; to: string }): Promise<Section[]> {
  const overrides = await db.query(
    `SELECT a.created_at::date::text AS date, a.entity_id, po.po_number, u.name AS actor, a.new_value->>'override_reason' AS reason,
            (a.new_value->>'total')::numeric AS amount, l.code AS lab_code
     FROM audit_log a
     JOIN purchase_orders po ON po.id = a.entity_id::int
     LEFT JOIN users u ON u.id = a.actor_id
     LEFT JOIN labs l ON l.id = po.lab_id
     WHERE a.action = 'po.approve' AND a.new_value->>'override' = 'true'
       AND ($1::int[] IS NULL OR po.lab_id = ANY($1::int[]))
       AND a.created_at::date BETWEEN $2::date AND $3::date
     ORDER BY a.id`,
    [req.labIds, period.from, period.to]
  );

  const closedOut = await db.query(
    `SELECT po.created_at::date::text AS date, po.po_number, po.status, COALESCE(po.rejection_reason, po.cancel_reason, '') AS reason,
            po.total AS amount, l.code AS lab_code
     FROM purchase_orders po JOIN labs l ON l.id = po.lab_id
     WHERE po.status IN ('rejected', 'cancelled') AND ($1::int[] IS NULL OR po.lab_id = ANY($1::int[]))
       AND po.updated_at::date BETWEEN $2::date AND $3::date
     ORDER BY po.id`,
    [req.labIds, period.from, period.to]
  );

  const receiptIssues = await db.query(
    `SELECT r.received_at::date::text AS date, r.receipt_no, po.po_number, i.description, rl.qty_rejected, rl.qty_accepted, rl.reject_reason, l.code AS lab_code
     FROM goods_receipt_lines rl
     JOIN goods_receipts r ON r.id = rl.receipt_id
     JOIN purchase_order_items i ON i.id = rl.po_item_id
     JOIN purchase_orders po ON po.id = r.po_id
     JOIN labs l ON l.id = r.lab_id
     WHERE rl.qty_rejected > 0 AND ($1::int[] IS NULL OR r.lab_id = ANY($1::int[]))
       AND r.received_at::date BETWEEN $2::date AND $3::date
     ORDER BY rl.id`,
    [req.labIds, period.from, period.to]
  );

  const invoices = await db.query(
    `SELECT si.created_at::date::text AS date, si.invoice_number, po.po_number, si.status, si.comparison->>'summary' AS summary,
            COALESCE((si.comparison->>'discrepancy_count')::int, 0) AS discrepancies, l.code AS lab_code
     FROM supplier_invoices si JOIN purchase_orders po ON po.id = si.po_id JOIN labs l ON l.id = po.lab_id
     WHERE (COALESCE((si.comparison->>'discrepancy_count')::int, 0) > 0 OR si.status = 'disputed')
       AND ($1::int[] IS NULL OR po.lab_id = ANY($1::int[]))
       AND si.created_at::date BETWEEN $2::date AND $3::date
     ORDER BY si.id`,
    [req.labIds, period.from, period.to]
  );

  return [
    {
      title: 'Budget overrides',
      columns: [
        { key: 'date', label: 'Date', type: 'text' },
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'po_number', label: 'PO number', type: 'text' },
        { key: 'amount', label: 'Order value', type: 'money' },
        { key: 'actor', label: 'Approved by', type: 'text' },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      rows: overrides.rows.map((row) => ({ date: row.date, lab: row.lab_code, po_number: row.po_number, amount: money(row.amount), actor: row.actor, reason: row.reason })),
      totals: null,
    },
    {
      title: 'Cancelled and rejected orders',
      columns: [
        { key: 'date', label: 'Date', type: 'text' },
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'po_number', label: 'PO number', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'amount', label: 'Order value', type: 'money' },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      rows: closedOut.rows.map((row) => ({ date: row.date, lab: row.lab_code, po_number: row.po_number, status: row.status, amount: money(row.amount), reason: row.reason })),
      totals: null,
    },
    {
      title: 'Damaged, short or rejected receipts',
      columns: [
        { key: 'date', label: 'Date', type: 'text' },
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'receipt_no', label: 'Receipt', type: 'text' },
        { key: 'po_number', label: 'PO number', type: 'text' },
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'qty_rejected', label: 'Rejected', type: 'number' },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      rows: receiptIssues.rows.map((row) => ({
        date: row.date,
        lab: row.lab_code,
        receipt_no: row.receipt_no,
        po_number: row.po_number,
        item: row.description,
        qty_rejected: toNumber(row.qty_rejected),
        reason: row.reject_reason,
      })),
      totals: null,
    },
    {
      title: 'Invoice discrepancies',
      columns: [
        { key: 'date', label: 'Date', type: 'text' },
        { key: 'lab', label: 'Lab', type: 'text' },
        { key: 'invoice_number', label: 'Invoice no.', type: 'text' },
        { key: 'po_number', label: 'PO number', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'text' },
      ],
      rows: invoices.rows.map((row) => ({ date: row.date, lab: row.lab_code, invoice_number: row.invoice_number, po_number: row.po_number, status: row.status, summary: row.summary ?? '' })),
      totals: null,
    },
  ];
}

export async function buildReport(db: Db, req: ReportRequest): Promise<ReportData> {
  const period = await resolvePeriod(db, req);
  const today = await todayIso(db);
  const base = {
    type: req.type,
    title: REPORT_TITLES[req.type],
    period,
    lab: req.singleLab ? { id: req.singleLab.id, name: req.singleLab.name, code: req.singleLab.code } : null,
    notes: [] as string[],
    reconciliation: null as ReportData['reconciliation'],
  };

  switch (req.type) {
    case 'stock_ledger': {
      const section = await stockLedger(db, req, period, today);
      const mismatches = Number(section.totals?.difference ?? 0);
      return { ...base, sections: [section], notes: section.note ? [section.note] : [], reconciliation: { ok: mismatches === 0, mismatches } };
    }
    case 'purchase_register':
      return { ...base, sections: [await purchaseRegister(db, req, period)] };
    case 'budget_statement':
      return { ...base, sections: await budgetStatement(db, req, period) };
    case 'stock_valuation':
      return { ...base, sections: [await stockValuation(db, req)] };
    case 'exceptions':
      return { ...base, sections: await exceptions(db, req, period) };
  }
}

// CSV of every section, one after another, with a blank line between sections.
export function reportToCsv(report: ReportData): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const blocks: string[] = [];
  for (const section of report.sections) {
    const lines = [section.columns.map((col) => escape(col.label)).join(',')];
    for (const row of section.rows) {
      lines.push(section.columns.map((col) => escape(row[col.key])).join(','));
    }
    if (section.totals) {
      lines.push(section.columns.map((col) => escape(section.totals![col.key] ?? '')).join(','));
    }
    blocks.push(`${section.title}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n') + '\n';
}
