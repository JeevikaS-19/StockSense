import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client.ts';
import { ReceiptSummary } from '../types/index.ts';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { EmptyState, buttonPrimary, buttonSecondary } from '../components/common/Field.tsx';
import { Printer } from 'lucide-react';
import { dateTime, quantity, humanize } from '../lib/format.ts';

interface ReceiptDetail extends Omit<ReceiptSummary, 'lines'> {
  po_number: string;
  po_status: string;
  po_id: number;
  supplier_name: string;
  supplier_address: string;
  lab_name: string;
  lab_code: string;
  lines: Array<ReceiptSummary['lines'][number] & { description: string; sku: string; unit: string; qty_ordered: number; unit_price: number }>;
  stock_movements: Array<{ id: number; product_id: number; type: string; quantity: number; balance_after: number; created_at: string }>;
}

// Goods receipt note (GRN). Receipts are never edited or deleted, so this page is read-only.
export const ReceiptPage: React.FC = () => {
  const { id } = useParams();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.receipts
      .get(Number(id))
      .then((res) => setReceipt(res.receipt))
      .catch((err) => setError(errorMessage(err, 'Could not load this receipt.')));
  }, [id]);

  if (error) return <EmptyState title="Receipt unavailable" text={error} action={<Link to="/purchase-orders" className={buttonSecondary}>Back to purchase orders</Link>} />;
  if (!receipt) return <PageLoading label="Loading receipt" />;

  const accepted = receipt.lines.reduce((sum, l) => sum + l.qty_accepted, 0);
  const rejected = receipt.lines.reduce((sum, l) => sum + l.qty_rejected, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link to={`/purchase-orders/${receipt.po_id}`} className="text-sm text-slate-500 hover:text-slate-800">← {receipt.po_number}</Link>
        <button type="button" className={buttonPrimary} onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print GRN
        </button>
      </div>

      <article className="print-doc rounded-lg border border-slate-200 bg-white p-6 md:p-8">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Goods receipt note</p>
            <h1 className="font-mono text-lg font-semibold text-slate-900">{receipt.receipt_no}</h1>
            <p className="text-sm text-slate-600">{receipt.lab_name} ({receipt.lab_code})</p>
          </div>
          <div className="text-sm text-slate-600 sm:text-right">
            <p>Received {dateTime(receipt.received_at)}</p>
            <p>By {receipt.received_by_name ?? 'Unknown'}</p>
            <p>Against <span className="font-mono">{receipt.po_number}</span></p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 py-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Supplier</p>
            <p className="font-medium text-slate-900">{receipt.supplier_name}</p>
            {receipt.supplier_address && <p className="text-slate-600">{receipt.supplier_address}</p>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Delivery</p>
            <p className="text-slate-900">Reference: {receipt.delivery_reference || '—'}</p>
            {receipt.note && <p className="text-slate-600">{receipt.note}</p>}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Accepted</th>
                <th className="px-3 py-2 text-right">Rejected</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipt.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-900">{line.description}</p>
                    <p className="font-mono text-xs text-slate-500">{line.sku}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{quantity(line.qty_accepted)} {line.unit}</td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${line.qty_rejected > 0 ? 'font-semibold text-rose-700' : ''}`}>
                    {line.qty_rejected > 0 ? `${quantity(line.qty_rejected)} ${line.unit}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{line.reject_reason ? humanize(line.reject_reason) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td className="px-3 py-2 text-right font-medium text-slate-700">Totals</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{quantity(accepted)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{quantity(rejected)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {receipt.stock_movements.length > 0 && (
          <p className="mt-4 text-xs text-slate-500">
            Stock updated: {receipt.stock_movements.map((m) => `${quantity(m.quantity)} units IN (balance ${quantity(m.balance_after)})`).join('; ')}.
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-slate-700">
          <div className="border-t border-slate-400 pt-1">Received by</div>
          <div className="border-t border-slate-400 pt-1">Checked by</div>
        </div>
        <p className="mt-6 border-t border-slate-200 pt-2 text-[10px] text-slate-500">System-generated receipt. Receipts are never edited or deleted.</p>
      </article>
    </div>
  );
};
