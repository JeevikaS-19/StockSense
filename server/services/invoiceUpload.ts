import { db, withTransaction } from '../db.ts';
import { fail } from '../errors.ts';
import { extractInvoice } from './ai.ts';
import { headerFromExtraction, poLinesFor, storeInvoice, type InvoiceHeader } from './invoices.ts';

const UPLOADABLE_STATUSES = ['approved', 'sent', 'partially_received', 'received', 'closed'];
export const INVOICE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const INVOICE_MAX_BYTES = 5 * 1024 * 1024;

export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

// Stores a supplier invoice against a PO and tries to read it with AI. If the read fails, the
// invoice is still stored with an empty form so the user can type the details in (manual entry).
// An invoice never changes stock.
export async function uploadInvoice(poId: number, actorId: number | null, file: UploadedFile) {
  if (!INVOICE_MIME_TYPES.includes(file.mimeType)) fail(400, 'UNSUPPORTED_FILE', 'Upload a JPG, PNG or PDF invoice.');
  if (file.buffer.length > INVOICE_MAX_BYTES) fail(413, 'FILE_TOO_LARGE', 'The invoice must be 5 MB or smaller.');

  const poRes = await db.query<{ lab_id: number; status: string }>('SELECT lab_id, status FROM purchase_orders WHERE id = $1', [poId]);
  if (poRes.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  const po = poRes.rows[0];
  if (!UPLOADABLE_STATUSES.includes(po.status)) {
    fail(409, 'INVALID_STATUS', `Invoices can be attached once the order is approved. This order is ${po.status.replace(/_/g, ' ')}.`);
  }

  const poLines = await poLinesFor(db, poId);
  const outcome = await extractInvoice(
    { buffer: file.buffer, mimeType: file.mimeType },
    poLines.map((line) => ({ id: line.id, description: line.description, quantity: line.qty_ordered, unit_price: line.unit_price }))
  );

  let header: InvoiceHeader = { invoice_number: '', invoice_date: null, tax: 0, total: null, items: [] };
  let source: 'gemini' | 'mock' | 'manual' = 'manual';
  if (outcome.ok) {
    header = headerFromExtraction(outcome.value, poLines);
    source = outcome.source;
  }

  const stored = await withTransaction((tx) =>
    storeInvoice(tx, {
      poId,
      labId: Number(po.lab_id),
      file,
      header,
      source,
      actorId,
    })
  );

  return {
    invoice: stored,
    extraction: outcome.ok ? 'read' : 'manual',
    reason: outcome.ok ? null : outcome.reason,
  };
}
