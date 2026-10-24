import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client.ts';
import { PurchaseOrderDetail } from '../types/index.ts';
import { money, quantity, dateOnly } from '../lib/format.ts';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { EmptyState, buttonPrimary, buttonSecondary } from '../components/common/Field.tsx';

// A4 purchase order. Shown outside the app shell so it prints as a document, not a web page.
export const PurchaseOrderPrintPage: React.FC = () => {
  const { id } = useParams();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [institution, setInstitution] = useState('REVA University');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.purchaseOrders.get(Number(id)), api.settings.get().catch(() => null)])
      .then(([res, settings]) => {
        setPo(res.purchase_order);
        if (settings?.settings?.institution_name) setInstitution(settings.settings.institution_name);
      })
      .catch((err) => setError(errorMessage(err, 'Could not load this purchase order.')));
  }, [id]);

  if (error) return <EmptyState title="Cannot print this order" text={error} action={<Link to="/purchase-orders" className={buttonSecondary}>Back</Link>} />;
  if (!po) return <div className="p-8"><PageLoading label="Preparing document" /></div>;

  const subtotal = po.items.reduce((sum, i) => sum + i.line_total, 0);

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <Link to={`/purchase-orders/${po.id}`} className="text-sm text-slate-600 hover:text-slate-900">← Back to order</Link>
        <button type="button" className={buttonPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <article className="print-doc mx-auto flex min-h-[297mm] w-full max-w-[210mm] flex-col bg-white p-[14mm] text-[12px] leading-snug text-slate-900 shadow-sm print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <p className="text-base font-bold uppercase tracking-wide">{institution}</p>
            <p className="text-[11px] text-slate-600">{po.lab_name} · {po.lab_department}</p>
            <p className="text-[11px] text-slate-600">{po.lab_location}</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold">PURCHASE ORDER</h1>
            <p className="font-mono text-sm font-semibold">{po.po_number}</p>
            <p className="text-[11px] text-slate-600">Date: {dateOnly(po.created_at)}</p>
            <p className="text-[11px] text-slate-600">Status: {po.status.replace(/_/g, ' ')}</p>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Supplier</p>
            <p className="font-semibold">{po.supplier_name}</p>
            {po.supplier_contact && <p>Attn: {po.supplier_contact}</p>}
            {po.supplier_address && <p className="whitespace-pre-line">{po.supplier_address}</p>}
            {po.supplier_email && <p>{po.supplier_email}</p>}
            {po.supplier_phone && <p>{po.supplier_phone}</p>}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Deliver to</p>
            <p className="font-semibold">{po.lab_name}</p>
            <p>{po.lab_department}</p>
            <p>{po.lab_location}</p>
            <p className="mt-2">Expected delivery: {po.expected_date ? dateOnly(po.expected_date) : 'As agreed'}</p>
          </div>
        </section>

        <table className="mt-5 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-slate-900 text-left">
              <th className="py-1.5 pr-2 w-8">#</th>
              <th className="py-1.5 pr-2">Description</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2">Unit</th>
              <th className="py-1.5 pr-2 text-right">Rate</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item, index) => (
              <tr key={item.id} className="border-b border-slate-200 align-top">
                <td className="py-1.5 pr-2">{index + 1}</td>
                <td className="py-1.5 pr-2">{item.description}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{quantity(item.qty_ordered)}</td>
                <td className="py-1.5 pr-2">{item.unit}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{money(item.unit_price)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{money(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-2 text-right text-[11px] text-slate-600">Subtotal</td>
              <td className="pt-2 text-right font-mono tabular-nums">{money(subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={5} className="pt-1 text-right text-sm font-bold">Total</td>
              <td className="pt-1 text-right font-mono text-sm font-bold tabular-nums">{money(po.total)}</td>
            </tr>
          </tfoot>
        </table>

        {po.notes && <p className="mt-4 text-[11px]"><span className="font-semibold">Notes:</span> {po.notes}</p>}

        <section className="mt-5 text-[11px] text-slate-700">
          <p className="font-semibold">Terms</p>
          <p>Goods are accepted subject to inspection at delivery. Please quote the purchase order number on the delivery challan and invoice. Payment is made against the approved invoice.</p>
        </section>

        <footer className="mt-auto grid grid-cols-3 gap-6 pt-14 text-[11px]">
          <div>
            <div className="border-t border-slate-900 pt-1">Prepared by{po.created_by_name ? `: ${po.created_by_name}` : ''}</div>
          </div>
          <div>
            <div className="border-t border-slate-900 pt-1">Approved by{po.approved_by_name ? `: ${po.approved_by_name}` : ''}</div>
          </div>
          <div>
            <div className="border-t border-slate-900 pt-1">Supplier acceptance (name and date)</div>
          </div>
        </footer>
        <p className="mt-6 border-t border-slate-200 pt-2 text-[9px] text-slate-500">System-generated purchase order · {po.po_number}</p>
      </article>
    </div>
  );
};
