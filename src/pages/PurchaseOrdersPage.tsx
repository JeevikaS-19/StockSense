import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { PurchaseOrderRow, Supplier } from '../types/index.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { PoStatusChip, Chip } from '../components/common/StatusChip.tsx';
import { buttonPrimary, inputClass, ErrorBanner } from '../components/common/Field.tsx';
import { Plus } from 'lucide-react';
import { money, dateOnly, PO_STATUS_LABEL } from '../lib/format.ts';

const STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'rejected', 'cancelled'];

export const PurchaseOrdersPage: React.FC = () => {
  const { user } = useAuth();
  const { activeLabId, activeLab } = useLab();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = params.get('status') ?? '';
  const supplierId = params.get('supplier') ?? '';
  const labId = typeof activeLabId === 'number' ? activeLabId : null;
  // Admins can see every lab at once; staff see their own labs (the server enforces this).
  const labFilter = activeLabId === 'all' ? null : labId;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    api.suppliers.list().then((res) => setSuppliers(res.suppliers)).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.purchaseOrders
      .list({ lab_id: labFilter ?? undefined, status, supplier_id: supplierId })
      .then((res) => !cancelled && setOrders(res.purchase_orders))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load purchase orders.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [labFilter, status, supplierId]);

  const columns: Column<PurchaseOrderRow>[] = [
    { key: 'po', header: 'PO number', render: (o) => <span className="font-mono text-xs font-semibold text-slate-900">{o.po_number}</span>, className: 'whitespace-nowrap' },
    { key: 'supplier', header: 'Supplier', render: (o) => <span className="font-medium text-slate-800">{o.supplier_name}</span> },
    ...(activeLabId === 'all' ? [{ key: 'lab', header: 'Lab', render: (o: PurchaseOrderRow) => <span className="font-mono text-xs">{o.lab_code}</span> } as Column<PurchaseOrderRow>] : []),
    { key: 'status', header: 'Status', render: (o) => <span className="flex items-center gap-1.5"><PoStatusChip status={o.status} />{o.source === 'auto' && <Chip>Auto</Chip>}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (o) => <span className="font-mono tabular-nums">{money(o.total)}</span> },
    { key: 'expected', header: 'Expected', render: (o) => <span className="whitespace-nowrap text-xs text-slate-500">{o.expected_date ? dateOnly(o.expected_date) : '—'}</span> },
    { key: 'created', header: 'Created', render: (o) => <span className="whitespace-nowrap text-xs text-slate-500">{dateOnly(o.created_at)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Purchase orders</h1>
          <p className="text-sm text-slate-500">
            {activeLabId === 'all' ? 'All laboratories' : activeLab?.name ?? 'Choose a laboratory'} · Approval, sending and receipt are tracked on each order.
          </p>
        </div>
        {labId !== null && (
          <button type="button" onClick={() => navigate('/purchase-orders/new')} className={buttonPrimary}>
            <Plus className="h-4 w-4" /> New purchase order
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Status" className={inputClass} value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PO_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Supplier" className={inputClass} value={supplierId} onChange={(e) => setFilter('supplier', e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {user?.role === 'admin' && activeLabId === 'all' && <p className="self-center text-xs text-slate-500 lg:col-span-2">Showing every laboratory.</p>}
      </div>

      <ErrorBanner message={error} />
      <DataTable
        columns={columns}
        rows={orders}
        rowKey={(o) => o.id}
        loading={loading}
        onRowClick={(o) => navigate(`/purchase-orders/${o.id}`)}
        emptyTitle={status ? `No ${PO_STATUS_LABEL[status]?.toLowerCase() ?? status} orders` : 'No purchase orders yet'}
        emptyText={labId === null && activeLabId !== 'all' ? 'Choose a laboratory to see its orders.' : 'Create an order, or let reorder rules draft one when stock runs low.'}
        emptyAction={
          labId !== null ? (
            <Link to="/purchase-orders/new" className={buttonPrimary}>
              <Plus className="h-4 w-4" /> New purchase order
            </Link>
          ) : undefined
        }
      />
    </div>
  );
};
