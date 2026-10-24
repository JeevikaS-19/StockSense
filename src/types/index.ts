export type Role = 'admin' | 'staff';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Lab {
  id: number;
  name: string;
  department: string;
  location: string;
  code: string;
  automation_mode: 'alert_only' | 'draft_po' | 'auto_send';
  auto_approve_limit: number;
  safety_days: number;
  product_count?: number;
  member_count?: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  email: string | null;
  phone: string;
  address: string;
  product_count?: number;
  open_po_count?: number;
  products?: { sku: string; name: string }[];
}

export type StockStatus = 'ok' | 'low' | 'out';

export interface Product {
  id: number;
  lab_id: number;
  sku: string;
  name: string;
  description: string;
  category: string;
  supplier_id: number | null;
  supplier_name?: string | null;
  unit: string;
  quantity: number;
  reorder_level: number;
  reorder_qty: number | null;
  lead_time_days: number;
  unit_price: number;
  on_order: number;
  effective_stock: number;
  status: StockStatus;
  is_active: boolean;
}

export interface ReorderRow {
  id: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  quantity: number;
  on_order: number;
  effective_stock: number;
  reorder_level: number;
  reorder_qty: number | null;
  lead_time_days: number;
  unit_price: number;
  supplier_id: number | null;
  supplier_name: string | null;
  below_reorder_point: boolean;
  out_of_stock: boolean;
  needs_supplier: boolean;
  suggested_order_qty: number;
}

export interface Transaction {
  id: number;
  lab_id: number;
  product_id: number;
  product_name: string;
  type: 'IN' | 'OUT';
  quantity: number;
  balance_after: number;
  party: string;
  note: string;
  user_id: number | null;
  user_name?: string | null;
  user_email?: string | null;
  created_at: string;
  reference_type: string | null;
  reference_id: number | null;
  reference_po_id: number | null;
  reference_receipt_no: string | null;
  reference_po_number: string | null;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface BudgetSummary {
  budget_id: number | null;
  period_label: string | null;
  start_date: string | null;
  end_date: string | null;
  allocated: number;
  committed: number;
  spent: number;
  available: number;
  percent_used: number;
  burn_rate_per_day: number;
  projected_exhaustion_date: string | null;
}

export interface DashboardStats {
  kpis: {
    total_products: number;
    total_stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
  };
  flow_30_days: Array<{ date: string; display_date: string; stock_in: number; stock_out: number }>;
  top_issued: Array<{ name: string; issued: number }>;
  recent_transactions: Transaction[];
  all_labs_overview: Array<{
    id: number;
    name: string;
    department: string;
    location: string;
    product_count: number;
    stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
    budget_available: number;
    budget_percent_used: number;
    budget_allocated: number;
  }>;
  budget: BudgetSummary | null;
}

export type PoStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrderRow {
  id: number;
  po_number: string;
  lab_id: number;
  supplier_id: number;
  status: PoStatus;
  total: number;
  source: 'manual' | 'auto';
  expected_date: string | null;
  created_at: string;
  supplier_name: string;
  lab_name: string;
  lab_code: string;
  item_count: number;
}

export interface PoItem {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  description: string;
  unit: string;
  qty_ordered: number;
  unit_price: number;
  line_total: number;
  qty_received: number;
  qty_rejected: number;
  outstanding: number;
  on_hand: number;
  lead_time_days: number;
}

export interface ReceiptSummary {
  id: number;
  receipt_no: string;
  received_at: string;
  delivery_reference: string;
  note: string;
  received_by_name: string | null;
  lines: Array<{
    id: number;
    po_item_id: number;
    qty_accepted: number;
    qty_rejected: number;
    reject_reason: string | null;
    note: string;
  }>;
}

export interface InvoiceComparisonLine {
  po_item_id: number | null;
  description: string;
  status: 'match' | 'qty_differs' | 'price_differs' | 'not_on_po';
  po_quantity: number | null;
  invoice_quantity: number;
  po_unit_price: number | null;
  invoice_unit_price: number;
  flags: { qty_differs: boolean; price_differs: boolean };
}

export interface InvoiceRow {
  id: number;
  po_id: number;
  lab_id: number;
  invoice_number: string;
  invoice_date: string | null;
  subtotal: number;
  tax: number;
  total: number;
  status: 'pending_review' | 'accepted' | 'disputed';
  extraction_source: 'gemini' | 'mock' | 'manual';
  comparison: {
    lines: InvoiceComparisonLine[];
    missing_from_invoice: Array<{ po_item_id: number; description: string; quantity: number }>;
    po_total: number;
    invoice_total: number;
    total_difference: number;
    discrepancy_count: number;
    summary: string;
  };
  extracted: {
    invoice_number: string;
    invoice_date: string | null;
    tax: number;
    total: number | null;
    items: Array<{ po_item_id: number | null; description: string; quantity: number; unit_price: number; line_total: number }>;
  };
  original_filename: string;
  note: string;
  created_at: string;
}

export interface PurchaseOrderDetail {
  id: number;
  po_number: string;
  lab_id: number;
  lab_name: string;
  lab_code: string;
  lab_department: string;
  lab_location: string;
  supplier_id: number;
  supplier_name: string;
  supplier_email: string | null;
  supplier_phone: string;
  supplier_address: string;
  supplier_contact: string;
  status: PoStatus;
  total: number;
  notes: string;
  source: 'manual' | 'auto';
  created_by: number | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  cancel_reason: string | null;
  close_reason: string | null;
  sent_at: string | null;
  expected_date: string | null;
  supplier_token: string;
  supplier_link: string;
  supplier_confirmed_at: string | null;
  created_at: string;
  items: PoItem[];
  receipts: Array<ReceiptSummary & { po_id?: number }>;
  invoices: InvoiceRow[];
  activity: Array<{ id: number; action: string; entity_type: string; old_value: any; new_value: any; created_at: string; actor_name: string | null }>;
  budget_impact: { available_now: number; po_total: number; available_after: number; reserves_budget: boolean };
}

export interface ReportSection {
  title: string;
  columns: Array<{ key: string; label: string; type: 'text' | 'number' | 'money' }>;
  rows: Record<string, any>[];
  totals: Record<string, any> | null;
  note?: string;
}

export interface ReportData {
  type: string;
  title: string;
  period: { from: string; to: string };
  lab: { id: number; name: string; code: string } | null;
  sections: ReportSection[];
  notes: string[];
  reconciliation: { ok: boolean; mismatches: number } | null;
}

export interface AppNotification {
  id: number;
  lab_id: number | null;
  lab_code?: string | null;
  type: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface RestockRequest {
  id: number;
  lab_id: number;
  lab_name: string;
  lab_code: string;
  product_id: number | null;
  product_name: string | null;
  product_sku: string | null;
  message: string;
  urgency: 'normal' | 'urgent';
  status: 'open' | 'resolved';
  requested_by: number;
  requested_by_name: string;
  resolved_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PaginatedTransactions {
  transactions: Transaction[];
  pagination: Pagination;
}
