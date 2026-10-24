import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { ReorderRow } from '../types/index.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { EmptyState, ErrorBanner, buttonPrimary, buttonSecondary, inputClass } from '../components/common/Field.tsx';
import { Chip } from '../components/common/StatusChip.tsx';
import { quantity } from '../lib/format.ts';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

// Inline editor for the three reorder fields. Saves when the field loses focus with a changed value.
const ReorderInputs: React.FC<{ row: ReorderRow; disabled?: boolean; onSaved: () => void }> = ({ row, disabled, onSaved }) => {
  const { activeLabId } = useLab();
  const { error: toastError, success } = useToast();
  const [level, setLevel] = useState(String(row.reorder_level));
  const [qty, setQty] = useState(row.reorder_qty ? String(row.reorder_qty) : '');
  const [lead, setLead] = useState(String(row.lead_time_days));

  const save = async (field: 'reorder_level' | 'reorder_qty' | 'lead_time_days', value: string) => {
    if (typeof activeLabId !== 'number') return;
    const current = field === 'reorder_level' ? row.reorder_level : field === 'reorder_qty' ? row.reorder_qty ?? '' : row.lead_time_days;
    if (String(current) === value) return;
    if (field === 'reorder_qty' && value !== '' && (!Number.isInteger(Number(value)) || Number(value) <= 0)) {
      toastError('Reorder quantity must be a whole number above zero.');
      setQty(row.reorder_qty ? String(row.reorder_qty) : '');
      return;
    }
    if (value === '' || Number.isNaN(Number(value)) || Number(value) < 0) {
      toastError('Enter a number of zero or more.');
      return;
    }
    try {
      await api.reorder.update(row.id, {
        lab_id: activeLabId,
        [field]: field === 'reorder_qty' ? (value === '' ? null : Number(value)) : Number(value),
      });
      success(`${row.name}: ${field === 'reorder_level' ? 'reorder point' : field === 'reorder_qty' ? 'reorder quantity' : 'lead time'} saved.`);
      onSaved();
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const cell = 'w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right font-mono text-sm tabular-nums focus:border-indigo-500 focus:outline-none disabled:bg-slate-100';
  return (
    <div className="flex items-center justify-end gap-2">
      <input aria-label={`Reorder point for ${row.name}`} disabled={disabled} type="number" min={0} className={cell} value={level} onChange={(e) => setLevel(e.target.value)} onBlur={() => save('reorder_level', level)} />
      <input aria-label={`Reorder quantity for ${row.name}`} disabled={disabled} type="number" min={1} placeholder="auto" className={cell} value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => save('reorder_qty', qty)} />
      <input aria-label={`Lead time in days for ${row.name}`} disabled={disabled} type="number" min={0} className={`${cell} w-16`} value={lead} onChange={(e) => setLead(e.target.value)} onBlur={() => save('lead_time_days', lead)} />
    </div>
  );
};

interface Suggestion {
  product_id: number;
  eligible: boolean;
  suggested_reorder_level: number;
  suggested_reorder_qty: number;
  reason: string;
}

export const ReorderPage: React.FC = () => {
  const { activeLabId, activeLab } = useLab();
  const { success, error: toastError } = useToast();
  const labId = typeof activeLabId === 'number' ? activeLabId : null;
  const [rows, setRows] = useState<ReorderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [belowOnly, setBelowOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<string>('draft_po');
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion>>({});
  const [applying, setApplying] = useState<number | 'all' | null>(null);

  const load = useCallback(async () => {
    if (labId === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.reorder.overview(labId);
      setRows(res.products);
      setMode(res.lab.automation_mode);
      // Suggestions are advisory: a failure here must not hide the reorder list.
      api.ai
        .thresholdSuggestions(labId)
        .then((s) => setSuggestions(Object.fromEntries(s.suggestions.map((x: Suggestion) => [x.product_id, x]))))
        .catch(() => setSuggestions({}));
    } catch (err) {
      setError(errorMessage(err, 'Could not load reorder data.'));
    } finally {
      setLoading(false);
    }
  }, [labId]);

  const applySuggestions = async (productIds: number[] | 'all') => {
    if (labId === null) return;
    setApplying(productIds === 'all' ? 'all' : productIds[0]);
    try {
      const res = await api.ai.applyThresholds({ lab_id: labId, product_ids: productIds });
      success(res.applied === 1 ? 'Suggested reorder settings applied.' : `${res.applied} products updated to the suggested settings. Each change is in the audit log.`);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setApplying(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (labId === null) return;
    setScanning(true);
    try {
      const res = await api.reorder.scan(labId);
      const { items_added, created_pos, updated_pos } = res.summary;
      success(
        items_added === 0
          ? 'No draft orders were needed. Every product is above its reorder point after open orders.'
          : `${items_added} item${items_added === 1 ? '' : 's'} added to draft orders: ${created_pos} created, ${updated_pos} updated.`
      );
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  };

  if (labId === null) return <EmptyState title="Choose a laboratory" text="Reorder rules run per laboratory. Pick one from the switcher." />;

  const visible = belowOnly ? rows.filter((r) => r.below_reorder_point) : rows;
  const needsSupplier = rows.filter((r) => r.needs_supplier);

  const columns: Column<ReorderRow>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.name}</p>
          <p className="font-mono text-xs text-slate-500">{r.sku}</p>
        </div>
      ),
    },
    {
      key: 'onhand',
      header: 'On hand',
      align: 'right',
      render: (r) => (
        <span className={`font-mono tabular-nums ${r.out_of_stock ? 'font-semibold text-rose-700' : r.below_reorder_point ? 'font-semibold text-amber-700' : ''}`}>
          {quantity(r.quantity)} {r.unit}
        </span>
      ),
    },
    { key: 'onorder', header: 'On order', align: 'right', render: (r) => <span className="font-mono tabular-nums">{r.on_order > 0 ? quantity(r.on_order) : '—'}</span> },
    { key: 'effective', header: 'Effective', align: 'right', render: (r) => <span className="font-mono tabular-nums text-slate-700">{quantity(r.effective_stock)}</span> },
    { key: 'supplier', header: 'Supplier', render: (r) => (r.supplier_name ? <span className="text-slate-700">{r.supplier_name}</span> : <Chip tone="rose">Needs supplier</Chip>) },
    {
      key: 'fields',
      header: (
        <span className="flex justify-end gap-2 text-right normal-case tracking-normal">
          <span className="w-20">Reorder point</span>
          <span className="w-20">Reorder qty</span>
          <span className="w-16">Lead days</span>
        </span>
      ),
      align: 'right',
      render: (r) => <ReorderInputs row={r} onSaved={load} />,
    },
    {
      key: 'suggested',
      header: 'Suggested',
      render: (r) => {
        const s = suggestions[r.id];
        if (!s) return <span className="text-xs text-slate-400">—</span>;
        if (!s.eligible) return <span className="text-xs text-slate-500" title={s.reason}>Needs history</span>;
        const same = s.suggested_reorder_level === r.reorder_level && s.suggested_reorder_qty === (r.reorder_qty ?? s.suggested_reorder_qty);
        return (
          <div className="min-w-[10rem] space-y-1" title={s.reason}>
            <p className="font-mono text-xs tabular-nums text-slate-700">
              Point {quantity(s.suggested_reorder_level)} · Qty {quantity(s.suggested_reorder_qty)}
            </p>
            <p className="line-clamp-2 text-xs text-slate-500">{s.reason}</p>
            {!same && (
              <button type="button" onClick={() => applySuggestions([r.id])} disabled={applying !== null} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                {applying === r.id ? 'Applying…' : 'Apply'}
              </button>
            )}
          </div>
        );
      },
    },
  ];
  const eligibleCount = Object.values(suggestions).filter((s) => s.eligible).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reorder</h1>
          <p className="text-sm text-slate-500">
            {activeLab?.name} · {mode === 'alert_only' ? 'Alerts only; no draft orders are created in this mode.' : 'Products at or below their reorder point are added to a draft order.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className={buttonSecondary} aria-label="Refresh">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={generate} disabled={scanning || mode === 'alert_only'} className={buttonPrimary} title={mode === 'alert_only' ? 'Switch the lab to draft mode in Settings to generate orders.' : undefined}>
            {scanning ? 'Generating…' : 'Generate draft POs'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Below reorder point</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-700">{rows.filter((r) => r.below_reorder_point).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Out of stock</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-rose-700">{rows.filter((r) => r.out_of_stock).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Needs a supplier</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">{needsSupplier.length}</p>
        </div>
      </div>

      {needsSupplier.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-rose-900">
            <AlertTriangle className="h-4 w-4" /> Needs a supplier before a draft can be created
          </p>
          <p className="mt-1 text-sm text-rose-800">
            {needsSupplier.map((r) => r.name).join(', ')}. Set a preferred supplier on the product.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setBelowOnly((v) => !v)} aria-pressed={belowOnly} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${belowOnly ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
          Below reorder point
        </button>
        <div className="flex items-center gap-4">
          {eligibleCount > 0 && (
            <button type="button" onClick={() => applySuggestions('all')} disabled={applying !== null} className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
              {applying === 'all' ? 'Applying…' : `Apply all suggestions (${eligibleCount})`}
            </button>
          )}
          <Link to="/purchase-orders?status=draft" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Review draft orders
          </Link>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => r.id}
        loading={loading && rows.length === 0}
        emptyTitle={belowOnly ? 'Nothing is below its reorder point' : 'No active products in this lab'}
        emptyText={belowOnly ? 'Every product is above its reorder point.' : 'Add products to start tracking reorder points.'}
      />
      <p className="text-xs text-slate-500">
        Reorder point and lead time are edited inline; changes are recorded in the audit log. Effective stock is on hand plus open orders, so a product already on an order is not ordered twice.
      </p>
    </div>
  );
};
