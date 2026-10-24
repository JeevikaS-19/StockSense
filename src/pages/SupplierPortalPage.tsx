import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client.ts';
import { Field, inputClass, buttonPrimary, ErrorBanner } from '../components/common/Field.tsx';
import { Chip } from '../components/common/StatusChip.tsx';
import { money, quantity, dateOnly, dateTime } from '../lib/format.ts';
import { Package2, Check, Upload } from 'lucide-react';

interface SupplierView {
  po_number: string;
  status: string;
  total: number;
  notes: string;
  expected_date: string | null;
  sent_at: string | null;
  supplier_name: string;
  buyer: { name: string; department: string; location: string };
  confirmed_at: string | null;
  items: Array<{ description: string; quantity: number; unit_price: number; line_total: number; received: number; rejected: number }>;
  invoices: Array<{ invoice_number: string; invoice_date: string | null; total: number; status: string; created_at: string }>;
}

// Public page for the supplier. It shows one purchase order, nothing else. Internal details are never returned.
export const SupplierPortalPage: React.FC = () => {
  const { token = '' } = useParams();
  const [view, setView] = useState<SupplierView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    api.publicPo
      .get(token)
      .then((res) => setView(res.purchase_order))
      .catch((err) => {
        if (err?.status === 404) setNotFound(true);
        else setError(errorMessage(err));
      });

  useEffect(() => {
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-8 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-900">Link not valid</p>
          <p className="mt-2 text-sm text-slate-600">This purchase order link is no longer valid. Contact the laboratory that sent it.</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
        <p className="text-sm text-slate-500">{error ?? 'Loading the purchase order…'}</p>
      </div>
    );
  }

  const canConfirm = view.status === 'sent' && !view.confirmed_at;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.publicPo.confirm(token);
      setView(res.purchase_order);
      setMessage('Thank you. The order is confirmed.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.publicPo.uploadInvoice(token, file);
      setMessage(`Invoice received${invoiceNumber ? ` (${invoiceNumber})` : ''}. The buyer will review it against this order.`);
      setInvoiceNumber('');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto max-w-3xl space-y-6 px-4">
        <header className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Package2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Purchase order for {view.supplier_name}</p>
            <h1 className="font-mono text-lg font-semibold text-slate-900">{view.po_number}</h1>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Buyer</p>
              <p className="font-medium text-slate-900">{view.buyer.name}</p>
              <p className="text-slate-600">{view.buyer.department}</p>
              <p className="text-slate-600">{view.buyer.location}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Sent</p>
              <p className="text-slate-900">{view.sent_at ? dateTime(view.sent_at) : 'Not yet'}</p>
              <p className="text-xs uppercase tracking-wide text-slate-500 mt-2">Expected delivery</p>
              <p className="text-slate-900">{view.expected_date ? dateOnly(view.expected_date) : '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
              <p className="text-slate-900 capitalize">{view.status.replace(/_/g, ' ')}</p>
              {view.confirmed_at && <Chip tone="emerald">Confirmed {dateTime(view.confirmed_at)}</Chip>}
            </div>
          </div>
        </section>

        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Item</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5 text-right">Rate</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-4 py-2.5">{item.description}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{quantity(item.quantity)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(item.unit_price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-right font-medium">Total</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{money(view.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {view.notes && <p className="rounded-lg bg-white p-4 text-sm text-slate-700 border border-slate-200">{view.notes}</p>}

        <ErrorBanner message={error} />
        {message && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}

        {canConfirm && (
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-700">Please confirm you have received this order and will deliver to the expected date.</p>
            <button type="button" className={buttonPrimary} onClick={confirm} disabled={busy}>
              <Check className="h-4 w-4" /> Confirm order
            </button>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Send your invoice</h2>
          <p className="text-sm text-slate-600">Upload a JPG, PNG or PDF of your invoice (up to 5 MB). Stock is updated only when the goods are received, not when the invoice arrives.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Invoice number" htmlFor="sp-inv">
              <input id="sp-inv" className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </Field>
            <Field label="Invoice file" htmlFor="sp-file">
              <input id="sp-file" type="file" accept="image/jpeg,image/png,application/pdf" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
            </Field>
          </div>
          {view.invoices.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {view.invoices.map((inv, index) => (
                <li key={index} className="flex items-center justify-between py-2">
                  <span>{inv.invoice_number || 'Invoice'} · {dateOnly(inv.created_at)}</span>
                  <span className="font-mono tabular-nums">{money(inv.total)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-center gap-1 text-xs text-slate-500"><Upload className="h-3 w-3" /> Received invoices are checked by the buyer.</p>
        </section>

        <p className="text-center text-xs text-slate-400">StockSense · Only this order is shown on this page.</p>
      </div>
    </div>
  );
};
