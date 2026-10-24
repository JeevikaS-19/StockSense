import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { DashboardStats } from '../types/index.ts';
import { KpiCard } from '../components/common/KpiCard.tsx';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Boxes, Wallet, AlertTriangle, XCircle, ArrowUpRight, ArrowDownLeft, Calendar, Building2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar } from 'recharts';
import { money, moneyWhole, percent, dateTime, quantity } from '../lib/format.ts';
import { Transaction } from '../types/index.ts';

const tooltipStyle = { backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '12px' };

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { activeLabId, activeLab, setActiveLabId } = useLab();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for a real lab (or the admin's "all" view) so the request is never sent with an unresolved value.
    if (activeLabId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.dashboard
      .stats(activeLabId)
      .then((res) => !cancelled && setStats(res))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load the dashboard.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeLabId]);

  if (activeLabId === null) {
    return (
      <EmptyState
        title="No laboratory assigned yet"
        text="Ask your laboratory administrator to add you to a laboratory. The dashboard will appear once you have one."
      />
    );
  }

  const isAll = activeLabId === 'all';
  const budget = stats?.budget ?? null;
  const budgetTone = budget && budget.percent_used >= 90 ? 'rose' : budget && budget.percent_used >= 75 ? 'amber' : 'default';

  const overviewColumns: Column<DashboardStats['all_labs_overview'][number]>[] = [
    { key: 'name', header: 'Laboratory', render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: 'dept', header: 'Department', render: (row) => row.department },
    { key: 'products', header: 'Products', align: 'right', render: (row) => <span className="font-mono tabular-nums">{row.product_count}</span> },
    { key: 'value', header: 'Stock value', align: 'right', render: (row) => <span className="font-mono tabular-nums">{moneyWhole(row.stock_value)}</span> },
    {
      key: 'budget',
      header: 'Budget left',
      align: 'right',
      render: (row) => (
        <span className={`font-mono tabular-nums ${row.budget_percent_used >= 90 ? 'text-rose-700' : row.budget_percent_used >= 75 ? 'text-amber-700' : ''}`}>
          {row.budget_allocated > 0 ? moneyWhole(row.budget_available) : '—'}
        </span>
      ),
    },
    {
      key: 'used',
      header: '% used',
      align: 'right',
      render: (row) => (row.budget_allocated > 0 ? percent(row.budget_percent_used) : '—'),
    },
    {
      key: 'low',
      header: 'Low / out',
      align: 'right',
      render: (row) => (
        <span className="font-mono tabular-nums">
          <span className={row.low_stock_count > 0 ? 'text-amber-700' : 'text-slate-400'}>{row.low_stock_count}</span>
          {' / '}
          <span className={row.out_of_stock_count > 0 ? 'text-rose-700' : 'text-slate-400'}>{row.out_of_stock_count}</span>
        </span>
      ),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      render: (row) => (
        <button type="button" onClick={() => setActiveLabId(row.id)} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
          Open lab
        </button>
      ),
    },
  ];

  const recentColumns: Column<Transaction>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${row.type === 'IN' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {row.type === 'IN' ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          {row.type === 'IN' ? 'Stock in' : 'Stock out'}
        </span>
      ),
    },
    { key: 'product', header: 'Product', render: (row) => <span className="font-medium text-slate-900">{row.product_name}</span> },
    ...(isAll ? [{ key: 'lab', header: 'Laboratory', render: (row: Transaction) => (row as any).lab_name ?? '—' } as Column<Transaction>] : []),
    { key: 'party', header: 'Party', render: (row) => row.party },
    { key: 'qty', header: 'Quantity', align: 'right', render: (row) => <span className="font-mono tabular-nums">{row.type === 'IN' ? '+' : '−'}{quantity(row.quantity)}</span> },
    { key: 'balance', header: 'Balance', align: 'right', render: (row) => <span className="font-mono tabular-nums text-slate-500">{quantity(row.balance_after)}</span> },
    { key: 'by', header: 'By', render: (row) => row.user_name ?? 'System' },
    { key: 'when', header: 'When', align: 'right', render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(row.created_at)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {isAll ? 'All laboratories' : activeLab ? activeLab.name : 'Dashboard'}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {isAll
            ? 'Stock and budget across every laboratory.'
            : activeLab
            ? `${activeLab.department} · ${activeLab.location} · ${activeLab.code}`
            : 'Stock, budget and movements for this laboratory.'}
        </p>
      </div>

      <ErrorBanner message={error} onRetry={() => setActiveLabId(activeLabId)} />
      {loading && !stats && <PageLoading label="Loading dashboard" />}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Products" value={stats.kpis.total_products} icon={Boxes} subtext="Active items" />
            <KpiCard label="Stock value" value={money(stats.kpis.total_stock_value)} icon={Wallet} subtext="At current unit cost" />
            <KpiCard label="Low stock" value={stats.kpis.low_stock_count} icon={AlertTriangle} variant="amber" subtext="At or below reorder point" />
            <KpiCard label="Out of stock" value={stats.kpis.out_of_stock_count} icon={XCircle} variant="rose" subtext="Zero balance" />
          </div>

          {!isAll && budget && (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-sm font-medium text-slate-900">Budget · {budget.period_label ?? 'Not set'}</p>
                  <p className="text-xs text-slate-500">
                    {budget.budget_id === null ? 'Set the allocation on the Budget page.' : `${money(budget.available)} available of ${money(budget.allocated)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Used</p>
                  <p className={`font-mono text-lg font-semibold tabular-nums ${budgetTone === 'rose' ? 'text-rose-700' : budgetTone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>
                    {percent(budget.percent_used)}
                  </p>
                </div>
                <Link to="/budget" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
                  View budget
                </Link>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Stock in and out, last 30 days</h2>
                  <p className="text-xs text-slate-500">Units received against units issued each day</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Calendar className="h-3.5 w-3.5" /> 30 days
                </span>
              </div>
              <div className="h-64 w-full">
                {stats.flow_30_days.some((d) => d.stock_in || d.stock_out) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.flow_30_days} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="display_date" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: '11px', paddingBottom: '12px' }} />
                      <Line type="monotone" dataKey="stock_in" name="Stock in" stroke="#4F46E5" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="stock_out" name="Stock out" stroke="#D97706" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">No stock movement in the last 30 days.</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">Top 5 issued items</h2>
              <p className="mb-4 text-xs text-slate-500">Most units issued in the last 30 days</p>
              <div className="h-64 w-full">
                {stats.top_issued.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.top_issued} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#334155' }} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 14)}…` : v)} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="issued" name="Units issued" fill="#6366F1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">Nothing has been issued in the last 30 days.</div>
                )}
              </div>
            </div>
          </div>

          {isAll && user?.role === 'admin' && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">Laboratory summary</h2>
              </div>
              <DataTable columns={overviewColumns} rows={stats.all_labs_overview} rowKey={(row) => row.id} emptyTitle="No laboratories yet" emptyText="Create a laboratory on the Labs & team page." />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Recent movements</h2>
            <DataTable
              columns={recentColumns}
              rows={stats.recent_transactions}
              rowKey={(row) => row.id}
              emptyTitle="No stock movements yet"
              emptyText="Stock in and out appear here as they are recorded."
            />
          </section>
        </>
      )}
      {!stats && !loading && !error && <EmptyState title="Nothing to show yet" />}
      <ArrowLinkHint />
    </div>
  );
};

// Small hint shown under the dashboard: the reorder rules run after every stock OUT.
const ArrowLinkHint: React.FC = () => (
  <p className="flex items-center gap-1.5 text-xs text-slate-500">
    <AlertTriangle className="h-3.5 w-3.5 text-slate-400" />
    Reorder rules run after every stock out. Review drafts on the <Link to="/purchase-orders?status=draft" className="font-medium text-indigo-600">purchase orders</Link> page.
  </p>
);
