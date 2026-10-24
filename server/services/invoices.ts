import type { Db, Row } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { notifyAdmins } from './notifications.ts';
import { inr } from './format.ts';
import type { Extraction } from './ai.ts';

export interface InvoiceLine {
  po_item_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoiceHeader {
  invoice_number: string;
  invoice_date: string | null;
  tax: number;
  total: number | null;
  items: InvoiceLine[];
}

interface PoLine {
  id: number;
  description: string;
  qty_ordered: number;
  unit_price: number;
}

// Keeps only lines that point at a line on this PO. The model may suggest ids; they are checked here.
export function normaliseLines(items: Array<Partial<InvoiceLine> & { po_item_id?: number | null }>, poLines: PoLine[]): InvoiceLine[] {
  const valid = new Set(poLines.map((line) => line.id));
  return items.map((item) => {
    const quantity = round2(toNumber(item.quantity));
    const unitPrice = round2(toNumber(item.unit_price));
    const poItemId = item.po_item_id !== null && item.po_item_id !== undefined && valid.has(Number(item.po_item_id)) ? Number(item.po_item_id) : null;
    return {
      po_item_id: poItemId,
      description: String(item.description ?? '').trim(),
      quantity,
      unit_price: unitPrice,
      line_total: round2(item.line_total !== undefined && item.line_total !== null ? toNumber(item.line_total) : quantity * unitPrice),
    };
  });
}

// Comparison is computed in code, never by the model. Each invoice line is matched to a PO line;
// PO lines without an invoice line are reported as missing.
export function compareInvoice(poLines: PoLine[], header: InvoiceHeader) {
  const poTotal = round2(poLines.reduce((sum, line) => sum + line.qty_ordered * line.unit_price, 0));
  const invoiceLineTotal = round2(header.items.reduce((sum, line) => sum + line.line_total, 0));
  const invoiceTotal = header.total !== null && header.total !== undefined ? round2(header.total) : round2(invoiceLineTotal + header.tax);

  // No lines entered yet (AI read failed and the user has not typed them): nothing to compare.
  if (header.items.length === 0) {
    return {
      lines: [],
      missing_from_invoice: [],
      po_total: poTotal,
      invoice_total: invoiceTotal,
      total_difference: 0,
      discrepancy_count: 0,
      summary: 'Invoice lines have not been entered yet.',
    };
  }

  const matchedIds = new Set<number>();
  const lines = header.items.map((line) => {
    if (line.po_item_id === null) {
      return {
        po_item_id: null,
        description: line.description,
        status: 'not_on_po',
        po_quantity: null,
        invoice_quantity: line.quantity,
        po_unit_price: null,
        invoice_unit_price: line.unit_price,
        flags: { qty_differs: false, price_differs: false },
      };
    }
    const poLine = poLines.find((candidate) => candidate.id === line.po_item_id)!;
    matchedIds.add(poLine.id);
    const qtyDiffers = Math.abs(line.quantity - poLine.qty_ordered) > 0.001;
    const priceDiffers = Math.abs(line.unit_price - poLine.unit_price) > 0.005;
    return {
      po_item_id: poLine.id,
      description: line.description || poLine.description,
      status: qtyDiffers ? 'qty_differs' : priceDiffers ? 'price_differs' : 'match',
      po_quantity: poLine.qty_ordered,
      invoice_quantity: line.quantity,
      po_unit_price: poLine.unit_price,
      invoice_unit_price: line.unit_price,
      flags: { qty_differs: qtyDiffers, price_differs: priceDiffers },
    };
  });

  const missing = poLines
    .filter((line) => !matchedIds.has(line.id))
    .map((line) => ({ po_item_id: line.id, description: line.description, quantity: line.qty_ordered }));

  const discrepancyCount = lines.filter((line) => line.status !== 'match').length + missing.length;
  const difference = round2(invoiceTotal - poTotal);
  const summary =
    discrepancyCount === 0 && difference === 0
      ? 'All lines match the purchase order.'
      : `${discrepancyCount} discrepanc${discrepancyCount === 1 ? 'y' : 'ies'}, invoice total ${
          difference === 0 ? 'matches the PO' : `${inr(Math.abs(difference))} ${difference > 0 ? 'higher' : 'lower'} than PO`
        }.`;

  return {
    lines,
    missing_from_invoice: missing,
    po_total: poTotal,
    invoice_total: invoiceTotal,
    total_difference: difference,
    discrepancy_count: discrepancyCount,
    summary,
  };
}

export function headerFromExtraction(extraction: Extraction, poLines: PoLine[]): InvoiceHeader {
  const items = normaliseLines(extraction.items as any, poLines);
  return {
    invoice_number: String(extraction.invoice_number ?? '').trim(),
    invoice_date: extraction.invoice_date ?? null,
    tax: round2(toNumber(extraction.tax)),
    total: extraction.total === null || extraction.total === undefined ? null : round2(Number(extraction.total)),
    items,
  };
}

export async function poLinesFor(db: Db, poId: number): Promise<PoLine[]> {
  const res = await db.query(
    'SELECT id, description, qty_ordered, unit_price FROM purchase_order_items WHERE po_id = $1 ORDER BY id',
    [poId]
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    description: row.description,
    qty_ordered: toNumber(row.qty_ordered),
    unit_price: toNumber(row.unit_price),
  }));
}

function storedColumns(header: InvoiceHeader, comparison: ReturnType<typeof compareInvoice>) {
  return {
    invoice_number: header.invoice_number,
    invoice_date: header.invoice_date,
    subtotal: round2(header.items.reduce((sum, line) => sum + line.line_total, 0)),
    tax: header.tax,
    total: comparison.invoice_total,
    extracted: { ...header },
    comparison,
  };
}

export async function storeInvoice(
  tx: Db,
  input: {
    poId: number;
    labId: number;
    file: { buffer: Buffer; mimeType: string; filename: string } | null;
    header: InvoiceHeader;
    source: 'gemini' | 'mock' | 'manual';
    actorId: number | null;
  }
): Promise<Row> {
  const poLines = await poLinesFor(tx, input.poId);
  const comparison = compareInvoice(poLines, input.header);
  const cols = storedColumns(input.header, comparison);

  const res = await tx.query(
    `INSERT INTO supplier_invoices (po_id, invoice_number, invoice_date, subtotal, tax, total, file_data,
       original_filename, mime_type, extraction_source, extracted, comparison, created_by)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
     RETURNING id`,
    [
      input.poId,
      cols.invoice_number,
      cols.invoice_date,
      cols.subtotal,
      cols.tax,
      cols.total,
      input.file ? input.file.buffer : null,
      input.file ? input.file.filename : '',
      input.file ? input.file.mimeType : '',
      input.source,
      JSON.stringify(cols.extracted),
      JSON.stringify(cols.comparison),
      input.actorId,
    ]
  );
  const id = Number(res.rows[0].id);

  await writeAudit(tx, {
    actorId: input.actorId,
    action: 'invoice.upload',
    entityType: 'supplier_invoice',
    entityId: id,
    labId: input.labId,
    newValue: { po_id: input.poId, source: input.source, discrepancies: comparison.discrepancy_count, summary: comparison.summary },
  });
  if (comparison.discrepancy_count > 0) {
    await notifyAdmins(tx, {
      labId: input.labId,
      type: 'invoice_discrepancy',
      title: `Invoice discrepancies on PO ${input.poId}`,
      body: comparison.summary,
      link: `/purchase-orders/${input.poId}`,
    });
  }
  return loadInvoice(tx, id);
}

export async function updateInvoiceLines(tx: Db, invoiceId: number, header: InvoiceHeader, actorId: number): Promise<Row> {
  const current = await loadInvoice(tx, invoiceId);
  if (current.status !== 'pending_review') {
    fail(409, 'INVALID_STATUS', `This invoice is ${current.status} and can no longer be edited.`, { status: current.status });
  }
  const poLines = await poLinesFor(tx, Number(current.po_id));
  const normalised = { ...header, items: normaliseLines(header.items as any, poLines) };
  const comparison = compareInvoice(poLines, normalised);
  const cols = storedColumns(normalised, comparison);

  await tx.query(
    `UPDATE supplier_invoices SET invoice_number = $1, invoice_date = $2::date, subtotal = $3, tax = $4, total = $5,
       extracted = $6::jsonb, comparison = $7::jsonb, extraction_source = 'manual'
     WHERE id = $8`,
    [cols.invoice_number, cols.invoice_date, cols.subtotal, cols.tax, cols.total, JSON.stringify(cols.extracted), JSON.stringify(cols.comparison), invoiceId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'invoice.update',
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    labId: current.lab_id,
    oldValue: { total: current.total, invoice_number: current.invoice_number },
    newValue: { total: cols.total, invoice_number: cols.invoice_number, discrepancies: comparison.discrepancy_count },
  });
  return loadInvoice(tx, invoiceId);
}

export async function reviewInvoice(tx: Db, invoiceId: number, action: 'accept' | 'dispute', actorId: number, note: string): Promise<Row> {
  const current = await loadInvoice(tx, invoiceId);
  if (current.status !== 'pending_review') {
    fail(409, 'INVALID_STATUS', `This invoice is already ${current.status}.`, { status: current.status });
  }
  const nextStatus = action === 'accept' ? 'accepted' : 'disputed';
  await tx.query(
    'UPDATE supplier_invoices SET status = $1, reviewed_by = $2, reviewed_at = NOW(), note = $3 WHERE id = $4',
    [nextStatus, actorId, note.trim(), invoiceId]
  );
  await writeAudit(tx, {
    actorId,
    action: `invoice.${action}`,
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    labId: current.lab_id,
    oldValue: { status: 'pending_review' },
    newValue: { status: nextStatus, note: note.trim() },
  });
  if (action === 'dispute') {
    await notifyAdmins(tx, {
      labId: current.lab_id,
      type: 'invoice_disputed',
      title: `Invoice ${current.invoice_number || invoiceId} disputed`,
      body: note.trim(),
      link: `/purchase-orders/${current.po_id}`,
    });
  }
  return loadInvoice(tx, invoiceId);
}

export async function loadInvoice(db: Db, invoiceId: number): Promise<Row> {
  const res = await db.query(
    `SELECT si.id, si.po_id, po.lab_id, si.invoice_number, si.invoice_date::text AS invoice_date, si.subtotal, si.tax, si.total,
            si.status, si.extraction_source, si.extracted, si.comparison, si.original_filename, si.note, si.created_at
     FROM supplier_invoices si JOIN purchase_orders po ON po.id = si.po_id WHERE si.id = $1`,
    [invoiceId]
  );
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Invoice not found.');
  const row = res.rows[0];
  return {
    ...row,
    id: Number(row.id),
    po_id: Number(row.po_id),
    lab_id: Number(row.lab_id),
    subtotal: toNumber(row.subtotal),
    tax: toNumber(row.tax),
    total: toNumber(row.total),
  };
}
