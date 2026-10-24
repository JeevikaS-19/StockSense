import React, { useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client.ts';
import { InvoiceRow, PurchaseOrderDetail } from '../../types/index.ts';
import { useToast } from '../common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, ErrorBanner } from '../common/Field.tsx';
import { Chip } from '../common/StatusChip.tsx';
import { money, quantity, dateOnly } from '../../lib/format.ts';
import { Upload, Check, X } from 'lucide-react';

interface EditLine {
  po_item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
}

const STATUS_TONE: Record<string, 'emerald' | 'rose' | 'amber'> = { accepted: 'emerald', disputed: 'rose', pending_review: 'amber' };

export const InvoicePanel: React.FC<{ po: PurchaseOrderDetail; isAdmin: boolean; onChanged: () => void }> = ({ po, isAdmin, onChanged }) => {
  const { success, error: toastError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [draft, setDraft] = useState({ invoice_number: '', invoice_date: '', tax: '0', total: '' });
  const [draftLines, setDraftLines] = useState<EditLine[]>([]);
  const [disputeOpen, setDisputeOpen] = useState<InvoiceRow | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = (invoice: InvoiceRow) => {
    setEditing(invoice);
    setDraft({
      invoice_number: invoice.invoice_number ?? '',
      invoice_date: invoice.invoice_date ?? '',
      tax: String(invoice.tax ?? 0),
      total: invoice.total ? String(invoice.total) : '',
    });
    const source = invoice.extracted?.items?.length
      ? invoice.extracted.items
      : po.items.map((item) => ({ po_item_id: item.id, description: item.description, quantity: item.qty_ordered, unit_price: item.unit_price, line_total: item.line_total }));
    setDraftLines(
      source.map((item) => ({
        po_item_id: item.po_item_id === null || item.po_item_id === undefined ? '' : String(item.po_item_id),
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
      }))
    );
    setError(null);
  };

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadNote(null);
    setError(null);
    try {
      const res = await api.purchaseOrders.uploadInvoice(po.id, file);
      if (res.extraction === 'read') {
        success('Invoice read. Check the lines against the order before accepting.');
        setUploadNote(null);
      } else {
        setUploadNote(res.reason ?? 'The invoice could not be read automatically. Enter its details below.');
      }
      onChanged();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toastError(message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.invoices.update(editing.id, {
        invoice_number: draft.invoice_number.trim(),
        invoice_date: draft.invoice_date || null,
        tax: Number(draft.tax) || 0,
        total: draft.total === '' ? null : Number(draft.total),
        items: draftLines.map((line) => ({
          po_item_id: line.po_item_id === '' ? null : Number(line.po_item_id),
          description: line.description.trim() || 'Item',
          quantity: Number(line.quantity) || 0,
          unit_price: Number(line.unit_price) || 0,
        })),
      });
      success('Invoice details saved. The comparison is updated.');
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const review = async (invoice: InvoiceRow, action: 'accept' | 'dispute', note = '') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'accept') await api.invoices.accept(invoice.id);
      else await api.invoices.dispute(invoice.id, note);
      success(action === 'accept' ? 'Invoice accepted. Its prices are used for spend on receipt.' : 'Invoice disputed. The administrator has been notified.');
      setDisputeOpen(null);
      setDisputeNote('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const invoices = po.invoices ?? [];

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="invoice-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="invoice-heading" className="text-sm font-semibold text-slate-900">Supplier invoice</h2>
          <p className="text-xs text-slate-500">Stock updates only when goods are received. An invoice never changes stock.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" id="invoice-file" aria-label="Upload supplier invoice" onChange={(e) => upload(e.target.files?.[0])} />
          <label htmlFor="invoice-file" className={`${buttonSecondary} cursor-pointer ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
            <Upload className="h-4 w-4" />
            {uploading ? 'Reading invoice…' : 'Upload invoice'}
          </label>
        </div>
      </div>

      <ErrorBanner message={error} />
      {uploadNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{uploadNote}</p>}
      {uploading && <div className="h-16 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />}

      {invoices.length === 0 && !uploading && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No invoice yet. Upload a JPG, PNG or PDF (up to 5 MB). Its lines are compared with this order.
        </p>
      )}

      {invoices.map((invoice) => (
        <div key={invoice.id} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-900">{invoice.invoice_number || 'No invoice number'}</span>
              <Chip tone={STATUS_TONE[invoice.status] ?? 'amber'}>{invoice.status.replace('_', ' ')}</Chip>
              <Chip>{invoice.extraction_source === 'manual' ? 'Entered manually' : 'Read by AI'}</Chip>
              {invoice.original_filename && <span className="text-xs text-slate-500">{invoice.original_filename}</span>}
            </div>
            <span className="text-xs text-slate-500">{dateOnly(invoice.created_at)}</span>
          </div>

          <div className={`rounded-md px-3 py-2 text-sm ${invoice.comparison.discrepancy_count > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>
            {invoice.comparison.summary}
          </div>

          {invoice.comparison.lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3 text-right">Qty (PO / invoice)</th>
                    <th className="py-2 pr-3 text-right">Price (PO / invoice)</th>
                    <th className="py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.comparison.lines.map((line, index) => {
                    const flagged = line.status !== 'match';
                    return (
                      <tr key={index} className={flagged ? 'bg-amber-50/60' : ''}>
                        <td className="py-2 pr-3 text-slate-800">{line.description}</td>
                        <td className={`py-2 pr-3 text-right font-mono tabular-nums ${line.flags.qty_differs ? 'font-semibold text-amber-800' : ''}`}>
                          {line.po_quantity === null ? '—' : quantity(line.po_quantity)} / {quantity(line.invoice_quantity)}
                        </td>
                        <td className={`py-2 pr-3 text-right font-mono tabular-nums ${line.flags.price_differs ? 'font-semibold text-amber-800' : ''}`}>
                          {line.po_unit_price === null ? '—' : money(line.po_unit_price)} / {money(line.invoice_unit_price)}
                        </td>
                        <td className="py-2 text-right">
                          {line.status === 'match' ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" /> Match</span>
                          ) : (
                            <span className="text-xs font-medium text-amber-800">{line.status === 'qty_differs' ? 'Quantity differs' : line.status === 'price_differs' ? 'Price differs' : 'Not on this order'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {invoice.comparison.missing_from_invoice.map((line) => (
                    <tr key={`missing-${line.po_item_id}`} className="bg-amber-50/60">
                      <td className="py-2 pr-3 text-slate-800">{line.description}</td>
                      <td className="py-2 pr-3 text-right font-mono">{quantity(line.quantity)} / —</td>
                      <td className="py-2 pr-3" />
                      <td className="py-2 text-right text-xs font-medium text-amber-800">Missing from invoice</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-right text-sm text-slate-700">
                Invoice total <span className="font-mono font-semibold">{money(invoice.comparison.invoice_total)}</span> · PO total <span className="font-mono">{money(invoice.comparison.po_total)}</span>
              </p>
            </div>
          )}

          {invoice.note && <p className="text-sm text-slate-600">Note: {invoice.note}</p>}

          {invoice.status === 'pending_review' && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" className={buttonSecondary} onClick={() => startEdit(invoice)} disabled={busy}>
                Edit details
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setDisputeOpen(invoice)} disabled={busy}>
                <X className="h-4 w-4" /> Dispute
              </button>
              {isAdmin && (
                <button type="button" className={buttonPrimary} onClick={() => review(invoice, 'accept')} disabled={busy}>
                  <Check className="h-4 w-4" /> Accept invoice
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {editing && (
        <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Invoice details</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Invoice number" htmlFor="inv-number">
              <input id="inv-number" className={inputClass} value={draft.invoice_number} onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })} />
            </Field>
            <Field label="Invoice date" htmlFor="inv-date">
              <input id="inv-date" type="date" className={inputClass} value={draft.invoice_date} onChange={(e) => setDraft({ ...draft, invoice_date: e.target.value })} />
            </Field>
            <Field label="Tax (₹)" htmlFor="inv-tax">
              <input id="inv-tax" type="number" min={0} step="0.01" className={inputClass} value={draft.tax} onChange={(e) => setDraft({ ...draft, tax: e.target.value })} />
            </Field>
            <Field label="Invoice total (₹)" htmlFor="inv-total" hint="Blank uses the lines plus tax.">
              <input id="inv-total" type="number" min={0} step="0.01" className={inputClass} value={draft.total} onChange={(e) => setDraft({ ...draft, total: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2">
            {draftLines.map((line, index) => (
              <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <input aria-label="Line description" className={`${inputClass} sm:col-span-4`} value={line.description} onChange={(e) => setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))} />
                <input aria-label="Line quantity" type="number" min={0} step="any" className={`${inputClass} sm:col-span-2 font-mono`} value={line.quantity} onChange={(e) => setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))} />
                <input aria-label="Line unit price" type="number" min={0} step="0.01" className={`${inputClass} sm:col-span-2 font-mono`} value={line.unit_price} onChange={(e) => setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, unit_price: e.target.value } : l)))} />
                <select aria-label="Matches order line" className={`${inputClass} sm:col-span-3`} value={line.po_item_id} onChange={(e) => setDraftLines(draftLines.map((l, i) => (i === index ? { ...l, po_item_id: e.target.value } : l)))}>
                  <option value="">Not on this order</option>
                  {po.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.description}
                    </option>
                  ))}
                </select>
                <button type="button" className="text-xs text-rose-700 sm:col-span-1" onClick={() => setDraftLines(draftLines.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="text-sm font-medium text-indigo-600" onClick={() => setDraftLines([...draftLines, { po_item_id: '', description: '', quantity: '1', unit_price: '0' }])}>
              + Add line
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className={buttonPrimary} onClick={saveEdit} disabled={busy}>
              {busy ? 'Saving…' : 'Save invoice details'}
            </button>
          </div>
        </div>
      )}

      {disputeOpen && (
        <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-4">
          <Field label="Why are you disputing this invoice?" htmlFor="dispute-note" required>
            <textarea id="dispute-note" rows={2} className={inputClass} value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setDisputeOpen(null)}>
              Cancel
            </button>
            <button type="button" className={buttonPrimary} disabled={disputeNote.trim().length < 3 || busy} onClick={() => review(disputeOpen, 'dispute', disputeNote)}>
              Dispute invoice
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
