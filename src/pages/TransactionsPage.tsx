import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Pagination, Product, Transaction } from '../types/index.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { EmptyState, ErrorBanner, buttonSecondary, inputClass } from '../components/common/Field.tsx';
import { Chip } from '../components/common/StatusChip.tsx';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { dateTime, quantity } from '../lib/format.ts';

export const TransactionsPage: React.FC = () => {
  const { activeLabId, activeLab, labs, setActiveLabId } = useLab();
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 20, total_pages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter changes return to page 1, and a different lab clears the product filter.
  useEffect(() => {
    setProductId('');
    setPagination((p) => ({ ...p, page: 1 }));
    if (labId === null) return;
    api.products
      .list({ lab_id: labId, limit: 100, sort_by: 'name' })
      .then((res) => setProducts(res.products))
      .catch(() => setProducts([]));
  }, [labId]);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [productId, type, from, to]);

  useEffect(() => {
    if (labId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.transactions
      .list({ lab_id: labId, product_id: productId, type, from, to, page: pagination.page, limit: pagination.limit })
      .then((res) => {
        if (cancelled) return;
        setTransactions(res.transactions);
        setPagination(res.pagination);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load transactions.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [labId, productId, type, from, to, pagination.page, pagination.limit]);

  if (labId === null) {
    return (
      <EmptyState
        title={activeLabId === 'all' ? 'Choose a laboratory' : 'No laboratory assigned'}
        text={activeLabId === 'all' ? 'The ledger is kept per laboratory. Pick one below.' : 'Ask your administrator to add you to a laboratory.'}
        action={
          activeLabId === 'all' ? (
            <div className="flex flex-wrap justify-center gap-2">
              {labs.map((lab) => (
                <button key={lab.id} type="button" onClick={() => setActiveLabId(lab.id)} className={buttonSecondary}>
                  {lab.name}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
    );
  }

  const columns: Column<Transaction>[] = [
    { key: 'when', header: 'When', render: (t) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(t.created_at)}</span> },
    {
      key: 'type',
      header: 'Type',
      render: (t) => (
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${t.type === 'IN' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {t.type === 'IN' ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          {t.type === 'IN' ? 'Stock in' : 'Stock out'}
        </span>
      ),
    },
    { key: 'product', header: 'Product', render: (t) => <span className="font-medium text-slate-900">{t.product_name}</span> },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      render: (t) => <span className="font-mono tabular-nums font-semibold text-slate-800">{t.type === 'IN' ? '+' : '−'}{quantity(t.quantity)}</span>,
    },
    { key: 'balance', header: 'Balance after', align: 'right', render: (t) => <span className="font-mono tabular-nums text-slate-500">{quantity(t.balance_after)}</span> },
    { key: 'party', header: 'Party', render: (t) => t.party },
    {
      key: 'ref',
      header: 'Reference',
      render: (t) =>
        t.reference_type === 'goods_receipt' && t.reference_po_id ? (
          <span className="flex flex-wrap gap-1">
            <Link to={`/receipts/${t.reference_id}`}>
              <Chip tone="blue">GRN {t.reference_receipt_no}</Chip>
            </Link>
            <Link to={`/purchase-orders/${t.reference_po_id}`}>
              <Chip>{t.reference_po_number}</Chip>
            </Link>
          </span>
        ) : (
          <span className="text-xs text-slate-500">{t.note || '—'}</span>
        ),
    },
    { key: 'by', header: 'By', render: (t) => <span className="text-xs text-slate-500">{t.user_name ?? 'System'}</span> },
  ];

  const fromRow = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const toRow = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Transactions</h1>
        <p className="text-sm text-slate-500">{activeLab?.name} · Every stock movement, in order. Entries are never edited.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Movement type" className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All movements</option>
          <option value="IN">Stock in</option>
          <option value="OUT">Stock out</option>
        </select>
        <select aria-label="Product" className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
        <input aria-label="From date" type="date" className={inputClass} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <input aria-label="To date" type="date" className={inputClass} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>

      <ErrorBanner message={error} />
      <DataTable
        columns={columns}
        rows={transactions}
        rowKey={(t) => t.id}
        loading={loading && transactions.length === 0}
        emptyTitle="No movements match these filters"
        emptyText="Stock in and out appear here once they are recorded."
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing <span className="font-mono tabular-nums">{fromRow}–{toRow}</span> of <span className="font-mono tabular-nums">{pagination.total}</span>
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className={buttonSecondary} disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}>
                Previous
              </button>
              <span className="font-mono tabular-nums">
                {pagination.page} / {pagination.total_pages}
              </span>
              <button type="button" className={buttonSecondary} disabled={pagination.page >= pagination.total_pages} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}>
                Next
              </button>
            </div>
          </div>
        }
      />
    </div>
  );
};
