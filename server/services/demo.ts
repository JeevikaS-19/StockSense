import bcrypt from 'bcryptjs';
import { withTransaction, type Db } from '../db.ts';
import { round2, toNumber } from '../errors.ts';
import { createLab, updateLab } from './labs.ts';
import { upsertBudget } from './budget.ts';
import { addLines, approvePurchaseOrder, createPurchaseOrderRow, rejectPurchaseOrder, sendPurchaseOrder, submitPurchaseOrder } from './purchaseOrders.ts';
import { receiveGoods } from './receiving.ts';
import { storeInvoice, type InvoiceHeader } from './invoices.ts';
import { createRestockRequest } from './requests.ts';
import { confirmSupplierOrder } from './supplierPortal.ts';
import { runIntegrityChecks, type IntegrityReport } from './integrity.ts';
import { getBudgetSummary, type BudgetSummary } from './budget.ts';

// Demo dataset (Prompt 6). Running it replaces all business data and recreates it, so it is safe to re-run.
// The stock history is simulated with a fixed random seed, and purchase orders, receipts, budgets and
// invoices are created through the same services the app uses, so every number reconciles.

export const DEMO_PASSWORDS = { admin: 'Admin@123', staff: 'Staff@123' };

interface LabSpec {
  code: string;
  name: string;
  department: string;
  location: string;
  budget: number;
  outParties: string[];
}

const LABS: LabSpec[] = [
  {
    code: 'EL',
    name: 'Electronics Lab',
    department: 'Electronics & Communication',
    location: 'Engineering Block B, Room 204',
    budget: 200000,
    outParties: ['Final-year project: Team Voltaire', 'Prof. Reynolds research group', 'Lab practical (Section A)', 'Lab practical (Section B)', 'Hackathon team KLS-07'],
  },
  {
    code: 'CH',
    name: 'Chemistry Lab',
    department: 'Chemistry',
    location: 'Science Complex, Room C-312',
    budget: 80000,
    outParties: ['Organic chemistry practical', 'Analytical chemistry practical', 'Prof. Rao research group', 'Teaching assistant stock'],
  },
  {
    code: 'CS',
    name: 'Computer Lab',
    department: 'Computer Science & Engineering',
    location: 'Turing Hall, Room T-108',
    budget: 150000,
    outParties: ['Networks lab practical', 'Capstone team CS-14', 'Staff: IT support', 'Seminar hall setup'],
  },
];

const SUPPLIERS = [
  { key: 'sharma', name: 'Sharma Electronics Components Pvt Ltd', contact: 'Rakesh Sharma', email: 'orders@sharma-electronics-demo.in', phone: '+91 80 4112 3300', address: 'Shop 12, Commercial Street, Bengaluru 560001' },
  { key: 'vishal', name: 'Vishal Wire & Connectors LLP', contact: 'Anita Vishal', email: 'sales@vishal-wires-demo.in', phone: '+91 44 2855 7810', address: '14 Ritchie Street, Chennai 600002' },
  { key: 'ganesh', name: 'Ganesh Lab Chemicals Pvt Ltd', contact: 'Dr. Suresh Ganesh', email: 'orders@ganesh-chemicals-demo.in', phone: '+91 22 2670 4455', address: 'Plot 88, MIDC Andheri East, Mumbai 400093' },
  { key: 'meridian', name: 'Meridian Scientific India Pvt Ltd', contact: 'Priya Menon', email: 'edu@meridian-scientific-demo.in', phone: '+91 124 430 9100', address: 'Sector 18, Udyog Vihar, Gurugram 122015' },
  { key: 'nexa', name: 'Nexa Computer Peripherals', contact: 'Kiran Patel', email: 'campus@nexa-peripherals-demo.in', phone: '+91 79 4002 6615', address: 'Iscon Cross Road, Ahmedabad 380015' },
  { key: 'kaveri', name: 'Kaveri Industrial Safety Supplies', contact: 'Meena Kaveri', email: 'supply@kaveri-safety-demo.in', phone: '+91 80 6600 2274', address: '3rd Phase, Peenya Industrial Area, Bengaluru 560058' },
];

type Mover = 'fast' | 'medium' | 'slow';

interface ProductSpec {
  lab: string;
  sku: string;
  name: string;
  category: string;
  supplier: string | null;
  unit: string;
  price: number;
  rop: number;
  rq: number;
  lead: number;
  qty: number; // on-hand after the 60-day history, before any purchase orders
  mover: Mover;
}

const PRODUCTS: ProductSpec[] = [
  // Electronics Lab (EL). Engineered states: four below reorder point (SLD has no draft PO),
  // one out of stock (MLT), one below reorder point with no supplier (ARD).
  { lab: 'EL', sku: 'EL-ARD-001', name: 'Arduino Uno R3', category: 'Microcontrollers', supplier: null, unit: 'pcs', price: 1450, rop: 8, rq: 20, lead: 5, qty: 6, mover: 'medium' },
  { lab: 'EL', sku: 'EL-ESP-002', name: 'ESP32-S3 DevKit', category: 'Microcontrollers', supplier: 'sharma', unit: 'pcs', price: 620, rop: 10, rq: 25, lead: 6, qty: 3, mover: 'fast' },
  { lab: 'EL', sku: 'EL-RES-003', name: 'Resistor Kit 1/4W (600 pcs)', category: 'Passive Components', supplier: 'sharma', unit: 'kits', price: 380, rop: 5, rq: 10, lead: 4, qty: 14, mover: 'slow' },
  { lab: 'EL', sku: 'EL-CAP-004', name: 'Ceramic Capacitor Assortment', category: 'Passive Components', supplier: 'sharma', unit: 'kits', price: 540, rop: 4, rq: 6, lead: 5, qty: 9, mover: 'slow' },
  { lab: 'EL', sku: 'EL-JMP-005', name: 'Jumper Wire Kit M-M 40 pc', category: 'Consumables', supplier: 'vishal', unit: 'kits', price: 180, rop: 15, rq: 40, lead: 3, qty: 6, mover: 'fast' },
  { lab: 'EL', sku: 'EL-BRD-006', name: 'Breadboard 830-point', category: 'Prototyping', supplier: 'vishal', unit: 'pcs', price: 210, rop: 10, rq: 20, lead: 3, qty: 4, mover: 'fast' },
  { lab: 'EL', sku: 'EL-SLD-007', name: 'Solder Wire 60/40 0.8 mm (500 g)', category: 'Consumables', supplier: 'vishal', unit: 'spools', price: 1150, rop: 5, rq: 6, lead: 4, qty: 2, mover: 'fast' },
  { lab: 'EL', sku: 'EL-MLT-008', name: 'Digital Multimeter DT-830B', category: 'Test Equipment', supplier: 'sharma', unit: 'pcs', price: 780, rop: 3, rq: 5, lead: 7, qty: 0, mover: 'slow' },
  { lab: 'EL', sku: 'EL-LED-009', name: 'LED Assortment 5 mm', category: 'Optoelectronics', supplier: 'sharma', unit: 'packs', price: 240, rop: 6, rq: 10, lead: 4, qty: 20, mover: 'medium' },
  { lab: 'EL', sku: 'EL-SEN-010', name: 'BME280 Temp/Humidity Sensor', category: 'Sensors', supplier: 'sharma', unit: 'pcs', price: 415, rop: 8, rq: 15, lead: 6, qty: 18, mover: 'medium' },
  { lab: 'EL', sku: 'EL-RLY-011', name: '5 V Relay Module', category: 'Modules', supplier: 'sharma', unit: 'pcs', price: 130, rop: 10, rq: 20, lead: 5, qty: 32, mover: 'medium' },
  { lab: 'EL', sku: 'EL-PSU-012', name: 'Breadboard Power Supply 5 V / 3.3 V', category: 'Power', supplier: 'sharma', unit: 'pcs', price: 350, rop: 4, rq: 6, lead: 7, qty: 9, mover: 'slow' },
  { lab: 'EL', sku: 'EL-TOL-013', name: 'Anti-static Tweezers Set', category: 'Tools', supplier: 'vishal', unit: 'sets', price: 260, rop: 3, rq: 4, lead: 5, qty: 7, mover: 'slow' },
  { lab: 'EL', sku: 'EL-WIR-014', name: 'Hookup Wire 22 AWG (10 m)', category: 'Consumables', supplier: 'vishal', unit: 'rolls', price: 175, rop: 5, rq: 8, lead: 4, qty: 15, mover: 'medium' },
  { lab: 'EL', sku: 'EL-OSC-015', name: 'Logic Analyser 8-channel', category: 'Test Equipment', supplier: 'sharma', unit: 'pcs', price: 1650, rop: 2, rq: 3, lead: 10, qty: 3, mover: 'slow' },
  // Chemistry Lab (CH)
  { lab: 'CH', sku: 'CH-ETH-101', name: 'Ethanol Absolute ACS (2.5 L)', category: 'Solvents', supplier: 'ganesh', unit: 'bottles', price: 1850, rop: 6, rq: 10, lead: 5, qty: 14, mover: 'fast' },
  { lab: 'CH', sku: 'CH-HCL-102', name: 'Hydrochloric Acid 37% (2.5 L)', category: 'Acids', supplier: 'ganesh', unit: 'bottles', price: 1420, rop: 5, rq: 8, lead: 6, qty: 11, mover: 'medium' },
  { lab: 'CH', sku: 'CH-NAOH-103', name: 'Sodium Hydroxide Pellets 500 g', category: 'Bases', supplier: 'ganesh', unit: 'bottles', price: 680, rop: 6, rq: 10, lead: 5, qty: 9, mover: 'medium' },
  { lab: 'CH', sku: 'CH-PHS-104', name: 'pH Test Strips 1-14', category: 'Indicators', supplier: 'meridian', unit: 'boxes', price: 540, rop: 8, rq: 12, lead: 4, qty: 15, mover: 'fast' },
  { lab: 'CH', sku: 'CH-BKR-105', name: 'Borosilicate Beaker 250 mL', category: 'Glassware', supplier: 'meridian', unit: 'pcs', price: 165, rop: 20, rq: 40, lead: 6, qty: 48, mover: 'fast' },
  { lab: 'CH', sku: 'CH-FLK-106', name: 'Conical Flask 250 mL', category: 'Glassware', supplier: 'meridian', unit: 'pcs', price: 150, rop: 20, rq: 40, lead: 6, qty: 36, mover: 'fast' },
  { lab: 'CH', sku: 'CH-GLV-107', name: 'Nitrile Gloves Medium (box of 100)', category: 'Safety & PPE', supplier: 'kaveri', unit: 'boxes', price: 690, rop: 10, rq: 20, lead: 3, qty: 4, mover: 'fast' },
  { lab: 'CH', sku: 'CH-GGS-108', name: 'Safety Goggles Anti-fog', category: 'Safety & PPE', supplier: 'kaveri', unit: 'pcs', price: 320, rop: 8, rq: 12, lead: 4, qty: 14, mover: 'slow' },
  { lab: 'CH', sku: 'CH-PIP-109', name: 'Pasteur Pipettes 3 mL', category: 'Consumables', supplier: 'meridian', unit: 'packs', price: 310, rop: 6, rq: 10, lead: 5, qty: 12, mover: 'fast' },
  { lab: 'CH', sku: 'CH-PHE-110', name: 'Phenolphthalein Indicator 100 mL', category: 'Indicators', supplier: 'ganesh', unit: 'bottles', price: 280, rop: 4, rq: 6, lead: 5, qty: 10, mover: 'slow' },
  { lab: 'CH', sku: 'CH-FLT-111', name: 'Filter Paper Grade 1 (100 mm)', category: 'Consumables', supplier: 'meridian', unit: 'packs', price: 720, rop: 4, rq: 6, lead: 7, qty: 8, mover: 'slow' },
  { lab: 'CH', sku: 'CH-BUR-112', name: 'Glass Burette 50 mL', category: 'Glassware', supplier: 'meridian', unit: 'pcs', price: 480, rop: 4, rq: 6, lead: 7, qty: 8, mover: 'slow' },
  // Computer Lab (CS)
  { lab: 'CS', sku: 'CS-SSD-201', name: 'NVMe M.2 1 TB SSD', category: 'Storage', supplier: 'nexa', unit: 'pcs', price: 6200, rop: 4, rq: 6, lead: 6, qty: 9, mover: 'slow' },
  { lab: 'CS', sku: 'CS-KBD-202', name: 'Mechanical Keyboard TKL', category: 'Peripherals', supplier: 'nexa', unit: 'pcs', price: 3400, rop: 4, rq: 8, lead: 7, qty: 10, mover: 'slow' },
  { lab: 'CS', sku: 'CS-CAB-203', name: 'Cat6 Patch Cable 3 m', category: 'Cabling', supplier: 'nexa', unit: 'pcs', price: 95, rop: 25, rq: 50, lead: 3, qty: 84, mover: 'fast' },
  { lab: 'CS', sku: 'CS-HDM-204', name: 'USB-C to HDMI Adapter', category: 'Adapters', supplier: 'nexa', unit: 'pcs', price: 1450, rop: 6, rq: 10, lead: 5, qty: 12, mover: 'medium' },
  { lab: 'CS', sku: 'CS-TNR-205', name: 'Laser Toner Cartridge 85A', category: 'Printing', supplier: 'nexa', unit: 'pcs', price: 4200, rop: 2, rq: 4, lead: 8, qty: 5, mover: 'slow' },
  { lab: 'CS', sku: 'CS-PPR-206', name: 'A4 Paper Ream (500 sheets)', category: 'Printing', supplier: 'nexa', unit: 'reams', price: 390, rop: 10, rq: 30, lead: 4, qty: 36, mover: 'fast' },
  { lab: 'CS', sku: 'CS-RAM-207', name: 'DDR4 16 GB 3200 MHz', category: 'Memory', supplier: 'nexa', unit: 'pcs', price: 3100, rop: 3, rq: 4, lead: 9, qty: 6, mover: 'slow' },
  { lab: 'CS', sku: 'CS-HDD-208', name: 'External Hard Disk 2 TB', category: 'Storage', supplier: 'nexa', unit: 'pcs', price: 5400, rop: 3, rq: 4, lead: 6, qty: 5, mover: 'slow' },
  { lab: 'CS', sku: 'CS-MOU-209', name: 'Optical Mouse USB', category: 'Peripherals', supplier: 'nexa', unit: 'pcs', price: 420, rop: 8, rq: 15, lead: 3, qty: 22, mover: 'medium' },
  { lab: 'CS', sku: 'CS-UPS-210', name: 'UPS 650 VA', category: 'Power', supplier: 'nexa', unit: 'pcs', price: 2900, rop: 2, rq: 3, lead: 10, qty: 4, mover: 'slow' },
  { lab: 'CS', sku: 'CS-WIP-211', name: 'Lab Wipes Alcohol-free', category: 'Cleaning', supplier: 'kaveri', unit: 'packs', price: 260, rop: 6, rq: 10, lead: 4, qty: 13, mover: 'fast' },
  { lab: 'CS', sku: 'CS-PPE-212', name: 'Anti-static Wrist Strap', category: 'Safety & PPE', supplier: 'kaveri', unit: 'pcs', price: 210, rop: 5, rq: 8, lead: 4, qty: 11, mover: 'slow' },
];

// Deterministic PRNG, so the demo history is identical on every run.
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface HistoryEvent {
  productId: number;
  labId: number;
  productName: string;
  type: 'IN' | 'OUT';
  quantity: number;
  balanceAfter: number;
  party: string;
  note: string;
  at: Date;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function at(base: Date, dayOffset: number, hour: number, minute: number): Date {
  return new Date(base.getTime() + dayOffset * 86400000 + hour * 3600000 + minute * 60000);
}

// The current academic half-year as a budget period (1 July to 31 December, or 1 January to 30 June).
function academicPeriod(): { label: string; start: string; end: string } {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const semester = now.getMonth() >= 6 ? 'Odd' : 'Even';
  const start = semester === 'Odd' ? `${startYear}-07-01` : `${startYear}-01-01`;
  const end = semester === 'Odd' ? `${startYear}-12-31` : `${startYear}-06-30`;
  return { label: `${startYear}-${String(startYear + 1).slice(2)} ${semester} Semester`, start, end };
}

// Simulates 60 days of movements per product. Every movement respects stock on hand (no negative stock).
// The last movement brings each product to its target quantity.
function simulateHistory(products: { id: number; labId: number; spec: ProductSpec }[], labParties: Map<number, string[]>, supplierNames: Map<string, string>): HistoryEvent[] {
  const rnd = mulberry32(20260901);
  const today = startOfToday();
  const events: HistoryEvent[] = [];
  const moverRate: Record<Mover, number> = { fast: 0.55, medium: 0.28, slow: 0.1 };

  for (const product of products) {
    const { spec } = product;
    const parties = labParties.get(product.labId) ?? ['Lab practical'];
    const supplier = spec.supplier ? supplierNames.get(spec.supplier)! : 'Opening stock';
    const local: HistoryEvent[] = [];
    let balance = 0;
    const push = (dayOffset: number, hour: number, minute: number, type: 'IN' | 'OUT', quantity: number, party: string, note: string) => {
      if (type === 'OUT') balance -= quantity;
      else balance += quantity;
      local.push({
        productId: product.id,
        labId: product.labId,
        productName: spec.name,
        type,
        quantity,
        balanceAfter: balance,
        party,
        note,
        at: at(today, dayOffset, hour, minute),
      });
    };

    push(-60, 10, 0, 'IN', Math.max(spec.rop * 2 + spec.rq, 1), supplier, 'Opening stock intake');
    for (let day = -59; day <= -1; day++) {
      const weekday = at(today, day, 12, 0).getDay();
      const weekend = weekday === 0 || weekday === 6;
      if (rnd() < moverRate[spec.mover] * (weekend ? 0.3 : 1) && balance > 0) {
        const maxIssue = Math.max(1, Math.floor(spec.rop / 2));
        const quantity = Math.min(balance, 1 + Math.floor(rnd() * maxIssue));
        const party = parties[Math.floor(rnd() * parties.length)];
        push(day, 9 + Math.floor(rnd() * 6), Math.floor(rnd() * 60), 'OUT', quantity, party, 'Issued for lab work');
      }
      if (balance < spec.rop && rnd() < 0.5 && spec.supplier) {
        push(day, 9 + Math.floor(rnd() * 3), Math.floor(rnd() * 60), 'IN', spec.rq, supplier, 'Restock received');
      }
    }

    const gap = spec.qty - balance;
    if (gap > 0) push(-1, 17, 0, 'IN', gap, supplier, 'Stock count adjustment');
    if (gap < 0) push(-1, 17, 0, 'OUT', -gap, parties[0], 'Stock count adjustment');
    events.push(...local);
  }
  return events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.productId - b.productId);
}

async function productId(tx: Db, labCode: string, sku: string): Promise<number> {
  const res = await tx.query(
    'SELECT p.id FROM products p JOIN labs l ON l.id = p.lab_id WHERE l.code = $1 AND p.sku = $2',
    [labCode, sku]
  );
  return Number(res.rows[0].id);
}

async function lineIds(tx: Db, poId: number): Promise<Map<number, number>> {
  const res = await tx.query('SELECT id, product_id FROM purchase_order_items WHERE po_id = $1', [poId]);
  return new Map(res.rows.map((row) => [Number(row.product_id), Number(row.id)]));
}

export interface DemoSummary {
  labs: { code: string; name: string; budget: BudgetSummary; open_pos: number }[];
  purchase_orders: number;
  receipts: number;
  transactions: number;
  integrity: IntegrityReport;
  credentials: { role: string; email: string; password: string }[];
}

export async function seedDemoData(): Promise<DemoSummary> {
  // 1. Replace everything (app settings such as the institution name are kept).
  await withTransaction((tx) =>
    tx.exec(
      `TRUNCATE audit_log, budget_ledger, notifications, goods_receipt_lines, goods_receipts, supplier_invoices,
         reports_log, purchase_order_items, purchase_orders, lab_budgets, transactions, restock_requests,
         invitations, products, lab_members, suppliers, labs, users, doc_sequences RESTART IDENTITY CASCADE`
    )
  );

  // 2. Users, labs, memberships, suppliers, products.
  const adminId = await withTransaction(async (tx) => {
    const admin = await tx.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
      ['Dr. Meera Nair', 'admin@stocksense.dev', await bcrypt.hash(DEMO_PASSWORDS.admin, 10)]
    );
    const arjun = await tx.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'staff') RETURNING id`,
      ['Arjun Rao', 'arjun@stocksense.dev', await bcrypt.hash(DEMO_PASSWORDS.staff, 10)]
    );
    const sneha = await tx.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'staff') RETURNING id`,
      ['Sneha Iyer', 'sneha@stocksense.dev', await bcrypt.hash(DEMO_PASSWORDS.staff, 10)]
    );
    return { admin: Number(admin.rows[0].id), arjun: Number(arjun.rows[0].id), sneha: Number(sneha.rows[0].id) };
  });
  const users = { admin: adminId.admin, arjun: adminId.arjun, sneha: adminId.sneha };

  const labIds = new Map<string, number>();
  await withTransaction(async (tx) => {
    for (const lab of LABS) {
      const created = await createLab(tx, { name: lab.name, department: lab.department, location: lab.location, code: lab.code }, users.admin);
      labIds.set(lab.code, Number(created.id));
      await updateLab(tx, Number(created.id), { automation_mode: 'draft_po', auto_approve_limit: 15000, safety_days: 3 }, users.admin);
    }
    await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2), ($3, $2) ON CONFLICT DO NOTHING', [labIds.get('EL'), users.arjun, labIds.get('CS')]);
    await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [labIds.get('CH'), users.sneha]);
    await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [labIds.get('CH'), users.admin]);
  });

  const supplierIds = new Map<string, number>();
  const supplierNames = new Map<string, string>();
  await withTransaction(async (tx) => {
    for (const s of SUPPLIERS) {
      const res = await tx.query(
        'INSERT INTO suppliers (name, contact_person, email, phone, address) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [s.name, s.contact, s.email, s.phone, s.address]
      );
      supplierIds.set(s.key, Number(res.rows[0].id));
      supplierNames.set(s.key, s.name);
    }
  });

  const productRows: { id: number; labId: number; spec: ProductSpec }[] = [];
  await withTransaction(async (tx) => {
    for (const spec of PRODUCTS) {
      const res = await tx.query(
        `INSERT INTO products (lab_id, sku, name, description, category, supplier_id, unit, quantity, reorder_level, reorder_qty, unit_price, lead_time_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11) RETURNING id`,
        [labIds.get(spec.lab), spec.sku, spec.name, `Standard stock item for ${spec.category.toLowerCase()}.`, spec.category, spec.supplier ? supplierIds.get(spec.supplier) : null, spec.unit, spec.rop, spec.rq, spec.price, spec.lead]
      );
      productRows.push({ id: Number(res.rows[0].id), labId: labIds.get(spec.lab)!, spec });
    }
  });

  // 3. Simulated 60-day history, written in time order.
  const labParties = new Map<number, string[]>(LABS.map((lab) => [labIds.get(lab.code)!, lab.outParties]));
  const history = simulateHistory(productRows, labParties, supplierNames);
  await withTransaction(async (tx) => {
    for (const event of history) {
      await tx.query(
        `INSERT INTO transactions (lab_id, product_id, product_name, type, quantity, balance_after, party, note, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [event.labId, event.productId, event.productName, event.type, event.quantity, event.balanceAfter, event.party, event.note, users.admin, event.at.toISOString()]
      );
    }
    for (const row of productRows) {
      await tx.query('UPDATE products SET quantity = $1 WHERE id = $2', [row.spec.qty, row.id]);
    }
  });

  // 4. Budgets, then purchase orders, receipts, invoices and restock requests through the real services.
  const period = academicPeriod();
  for (const lab of LABS) {
    await withTransaction((tx) =>
      upsertBudget(tx, labIds.get(lab.code)!, { period_label: period.label, start_date: period.start, end_date: period.end, allocated: lab.budget }, users.admin)
    );
  }

  const pid = (code: string, sku: string) => withTransaction((tx) => productId(tx, code, sku));
  const today = new Date().toISOString().slice(0, 10);

  // Electronics: automatic draft (reorder rules), pending approval, sent and supplier-confirmed, partially received, fully received, rejected.
  const el = labIds.get('EL')!;
  await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('sharma')!, createdBy: null, source: 'auto', notes: 'Generated by reorder rules.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'EL', 'EL-ESP-002'), quantity: 17 },
      { product_id: await productId(tx, 'EL', 'EL-MLT-008'), quantity: 5 },
    ], null);
  });

  await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('vishal')!, createdBy: users.arjun, source: 'manual', notes: 'Consumables for the next practical cycle.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'EL', 'EL-JMP-005'), quantity: 40 },
      { product_id: await productId(tx, 'EL', 'EL-BRD-006'), quantity: 20 },
    ], users.arjun);
    await submitPurchaseOrder(tx, Number(po.id), users.arjun);
  });

  const elSent = await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('sharma')!, createdBy: users.admin, source: 'manual', notes: 'Passive components and LED stock.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'EL', 'EL-RES-003'), quantity: 40 },
      { product_id: await productId(tx, 'EL', 'EL-RLY-011'), quantity: 200 },
      { product_id: await productId(tx, 'EL', 'EL-LED-009'), quantity: 100 },
    ], users.admin);
    await submitPurchaseOrder(tx, Number(po.id), users.admin);
    await approvePurchaseOrder(tx, Number(po.id), users.admin);
    await sendPurchaseOrder(tx, Number(po.id), users.admin);
    return { id: Number(po.id), token: po.supplier_token as string };
  });
  await confirmSupplierOrder(elSent.token);
  await withTransaction(async (tx) => {
    const rows = await tx.query(
      'SELECT i.id, i.description, i.qty_ordered, i.unit_price, p.sku FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = $1 ORDER BY i.id',
      [elSent.id]
    );
    const header: InvoiceHeader = {
      invoice_number: 'SEL-2026-0917',
      invoice_date: today,
      tax: 0,
      total: null,
      items: rows.rows.map((row: any, index: number) => {
        const price = index === 0 ? round2(toNumber(row.unit_price) * 1.05) : toNumber(row.unit_price);
        const qty = toNumber(row.qty_ordered);
        return { po_item_id: Number(row.id), description: row.description, quantity: qty, unit_price: price, line_total: round2(qty * price) };
      }),
    };
    await storeInvoice(tx, { poId: elSent.id, labId: el, file: null, header, source: 'manual', actorId: users.admin });
  });

  const elPartial = await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('sharma')!, createdBy: users.admin, source: 'manual', notes: 'Sensors and power for the IoT practical.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'EL', 'EL-SEN-010'), quantity: 15 },
      { product_id: await productId(tx, 'EL', 'EL-PSU-012'), quantity: 6 },
      { product_id: await productId(tx, 'EL', 'EL-OSC-015'), quantity: 6 },
    ], users.admin);
    await submitPurchaseOrder(tx, Number(po.id), users.admin);
    await approvePurchaseOrder(tx, Number(po.id), users.admin);
    await sendPurchaseOrder(tx, Number(po.id), users.admin);
    return Number(po.id);
  });
  {
    const items = await withTransaction((tx) => lineIds(tx, elPartial));
    await receiveGoods(elPartial, users.admin, {
      delivery_reference: 'DC-88412',
      note: 'Two power supplies arrived with cracked casings.',
      lines: [
        { po_item_id: items.get(await pid('EL', 'EL-SEN-010'))!, qty_accepted: 15, qty_rejected: 0 },
        { po_item_id: items.get(await pid('EL', 'EL-PSU-012'))!, qty_accepted: 4, qty_rejected: 2, reject_reason: 'damaged' },
        { po_item_id: items.get(await pid('EL', 'EL-OSC-015'))!, qty_accepted: 0, qty_rejected: 0 },
      ],
    });
  }

  const elFull = await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('vishal')!, createdBy: users.admin, source: 'manual', notes: 'Tools and wire restock.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'EL', 'EL-TOL-013'), quantity: 40 },
      { product_id: await productId(tx, 'EL', 'EL-WIR-014'), quantity: 60 },
    ], users.admin);
    await submitPurchaseOrder(tx, Number(po.id), users.admin);
    await approvePurchaseOrder(tx, Number(po.id), users.admin);
    await sendPurchaseOrder(tx, Number(po.id), users.admin);
    return Number(po.id);
  });
  {
    const items = await withTransaction((tx) => lineIds(tx, elFull));
    await receiveGoods(elFull, users.admin, {
      delivery_reference: 'DC-88477',
      lines: [
        { po_item_id: items.get(await pid('EL', 'EL-TOL-013'))!, qty_accepted: 40, qty_rejected: 0 },
        { po_item_id: items.get(await pid('EL', 'EL-WIR-014'))!, qty_accepted: 60, qty_rejected: 0 },
      ],
    });
  }

  await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: el, supplierId: supplierIds.get('sharma')!, createdBy: users.arjun, source: 'manual', notes: 'Extra LEDs for the robotics club.' });
    await addLines(tx, po, [{ product_id: await productId(tx, 'EL', 'EL-LED-009'), quantity: 20 }], users.arjun);
    await submitPurchaseOrder(tx, Number(po.id), users.arjun);
    await rejectPurchaseOrder(tx, Number(po.id), users.admin, 'Quoted price is above the contract rate. Please re-quote.');
  });

  // Chemistry: one sent order (about 88% of the budget committed).
  const ch = labIds.get('CH')!;
  await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: ch, supplierId: supplierIds.get('ganesh')!, createdBy: users.sneha, source: 'manual', notes: 'Semester reagent order.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'CH', 'CH-ETH-101'), quantity: 20 },
      { product_id: await productId(tx, 'CH', 'CH-HCL-102'), quantity: 15 },
      { product_id: await productId(tx, 'CH', 'CH-NAOH-103'), quantity: 10 },
      { product_id: await productId(tx, 'CH', 'CH-PHE-110'), quantity: 20 },
    ], users.sneha);
    await submitPurchaseOrder(tx, Number(po.id), users.sneha);
    await approvePurchaseOrder(tx, Number(po.id), users.admin);
    await sendPurchaseOrder(tx, Number(po.id), users.admin);
  });

  // Computer: one fully received order (about 30% of the budget spent).
  const cs = labIds.get('CS')!;
  const csFull = await withTransaction(async (tx) => {
    const po = await createPurchaseOrderRow(tx, { labId: cs, supplierId: supplierIds.get('nexa')!, createdBy: users.admin, source: 'manual', notes: 'Storage and toner for the year.' });
    await addLines(tx, po, [
      { product_id: await productId(tx, 'CS', 'CS-SSD-201'), quantity: 3 },
      { product_id: await productId(tx, 'CS', 'CS-KBD-202'), quantity: 4 },
      { product_id: await productId(tx, 'CS', 'CS-CAB-203'), quantity: 40 },
      { product_id: await productId(tx, 'CS', 'CS-TNR-205'), quantity: 2 },
    ], users.admin);
    await submitPurchaseOrder(tx, Number(po.id), users.admin);
    await approvePurchaseOrder(tx, Number(po.id), users.admin);
    await sendPurchaseOrder(tx, Number(po.id), users.admin);
    return Number(po.id);
  });
  {
    const items = await withTransaction((tx) => lineIds(tx, csFull));
    await receiveGoods(csFull, users.admin, {
      delivery_reference: 'NX-INV-44102',
      lines: [
        { po_item_id: items.get(await pid('CS', 'CS-SSD-201'))!, qty_accepted: 3, qty_rejected: 0 },
        { po_item_id: items.get(await pid('CS', 'CS-KBD-202'))!, qty_accepted: 4, qty_rejected: 0 },
        { po_item_id: items.get(await pid('CS', 'CS-CAB-203'))!, qty_accepted: 40, qty_rejected: 0 },
        { po_item_id: items.get(await pid('CS', 'CS-TNR-205'))!, qty_accepted: 2, qty_rejected: 0 },
      ],
    });
  }

  // Two open restock requests from staff.
  await withTransaction(async (tx) => {
    await createRestockRequest(tx, el, { id: users.arjun, name: 'Arjun Rao', email: 'arjun@stocksense.dev', role: 'staff' }, {
      product_id: await productId(tx, 'EL', 'EL-SLD-007'),
      message: 'Solder wire is almost finished. The second-year practical starts Monday.',
      urgency: 'urgent',
    });
    await createRestockRequest(tx, ch, { id: users.sneha, name: 'Sneha Iyer', email: 'sneha@stocksense.dev', role: 'staff' }, {
      product_id: await productId(tx, 'CH', 'CH-GLV-107'),
      message: 'Nitrile gloves are running low for the Monday batch.',
      urgency: 'normal',
    });
  });

  // 5. Verify before reporting success.
  const integrity = await withTransaction((tx) => runIntegrityChecks(tx));
  const labSummaries: DemoSummary['labs'] = [];
  for (const lab of LABS) {
    const id = labIds.get(lab.code)!;
    const budget = await withTransaction((tx) => getBudgetSummary(tx, id));
    const open = await withTransaction((tx) =>
      tx.query("SELECT COUNT(*)::int AS n FROM purchase_orders WHERE lab_id = $1 AND status IN ('draft','pending_approval','approved','sent','partially_received')", [id])
    );
    labSummaries.push({ code: lab.code, name: lab.name, budget, open_pos: open.rows[0].n });
  }

  const counts = await withTransaction(async (tx) => ({
    purchase_orders: (await tx.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchase_orders')).rows[0].n,
    receipts: (await tx.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM goods_receipts')).rows[0].n,
    transactions: (await tx.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,
  }));
  return {
    labs: labSummaries,
    ...counts,
    integrity,
    credentials: [
      { role: 'Admin', email: 'admin@stocksense.dev', password: DEMO_PASSWORDS.admin },
      { role: 'Staff (Electronics, Computer)', email: 'arjun@stocksense.dev', password: DEMO_PASSWORDS.staff },
      { role: 'Staff (Chemistry)', email: 'sneha@stocksense.dev', password: DEMO_PASSWORDS.staff },
    ],
  };
}
