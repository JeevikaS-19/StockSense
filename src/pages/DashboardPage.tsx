import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { DashboardStats } from '../types/index.ts';
import { EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { money, moneyWhole, percent, quantity, dateTime } from '../lib/format.ts';

const tooltipStyle = { backgroundColor: '#FFFFFF', borderRadius: '14px', border: 'none', boxShadow: '0 8px 20px rgba(232,116,59,0.18)', fontSize: '13px' };

// One clay tile with one number. Kept deliberately small so the dashboard reads at a glance.
const Tile: React.FC<{ label: string; value: string; hint?: string; tone?: 'default' | 'attention' | 'alert' }> = ({ label, value, hint, tone = 'default' }) => (
  <div className="clay p-5">
    <p className="text-sm font-semibold text-slate-500">{label}</p>
    <p className={`mt-2 text-3xl font-extrabold tracking-tight tabular-nums ${tone === 'alert' ? 'text-rose-700' : tone === 'attention' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p>
    {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
  </div>
);

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
    return <EmptyState title="No laboratory yet" text="Ask your administrator to add you to a laboratory." />;
  }

  const isAll = activeLabId === 'all';
  const budget = stats?.budget ?? null;
  const attention = stats ? stats.kpis.low_stock_count + stats.kpis.out_of_stock_count : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {isAll ? 'All laboratories' : activeLab ? activeLab.name : 'Dashboard'}
        </h1>
        <p className="mt-1 text-slate-500">{isAll ? 'Stock and budget across every lab' : activeLab ? `${activeLab.department} · ${activeLab.location}` : ''}</p>
      </div>

      <ErrorBanner message={error} onRetry={() => setActiveLabId(activeLabId)} />
      {loading && !stats && <PageLoading label="Loading dashboard" />}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Products" value={String(stats.kpis.total_products)} hint="Active items" />
            <Tile label="Need attention" value={String(attention)} hint={`${stats.kpis.low_stock_count} low · ${stats.kpis.out_of_stock_count} out`} tone={attention > 0 ? 'attention' : 'default'} />
            <Tile label="Budget left" value={budget && budget.budget_id !== null ? moneyWhole(budget.available) : '—'} hint={budget && budget.budget_id !== null ? `${percent(budget.percent_used)} used` : isAll ? 'See each lab below' : 'Not set yet'} tone={budget && budget.percent_used >= 90 ? 'alert' : budget && budget.percent_used >= 75 ? 'attention' : 'default'} />
            <Tile label="Stock value" value={moneyWhole(stats.kpis.total_stock_value)} hint="At current cost" />
          </div>

          <section className="clay p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-bold text-slate-900">Last 30 days</h2>
              <span className="text-sm text-slate-500">Units in and out</span>
            </div>
            <div className="h-64 w-full">
              {stats.flow_30_days.some((d) => d.stock_in || d.stock_out) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.flow_30_days} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#FFD9BF" />
                    <XAxis dataKey="display_date" tick={{ fontSize: 12, fill: '#8A6A58' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12, fill: '#8A6A58' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: '13px', paddingBottom: '8px' }} />
                    <Line type="monotone" dataKey="stock_in" name="In" stroke="#E8743B" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="stock_out" name="Out" stroke="#FFB347" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">No movement in the last 30 days.</div>
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="clay p-6">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Latest movements</h2>
              {stats.recent_transactions.length === 0 ? (
                <p className="text-slate-500">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {stats.recent_transactions.slice(0, 5).map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{tx.product_name}</p>
                        <p className="text-sm text-slate-500">{dateTime(tx.created_at)}</p>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold tabular-nums ${tx.type === 'IN' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                        {tx.type === 'IN' ? '+' : '−'}
                        {quantity(tx.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {isAll && user?.role === 'admin' ? (
              <section className="clay p-6">
                <h2 className="mb-4 text-lg font-bold text-slate-900">Labs</h2>
                <ul className="space-y-3">
                  {stats.all_labs_overview.map((lab) => (
                    <li key={lab.id}>
                      <button type="button" onClick={() => setActiveLabId(lab.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl p-3 text-left hover:bg-orange-50">
                        <span>
                          <span className="block font-semibold text-slate-900">{lab.name}</span>
                          <span className="block text-sm text-slate-500">{lab.product_count} products · {lab.low_stock_count + lab.out_of_stock_count} need attention</span>
                        </span>
                        <span className={`text-sm font-bold ${lab.budget_percent_used >= 90 ? 'text-rose-700' : lab.budget_percent_used >= 75 ? 'text-amber-700' : 'text-slate-700'}`}>
                          {lab.budget_allocated > 0 ? `${percent(lab.budget_percent_used)} used` : 'No budget'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className="clay p-6">
                <h2 className="mb-4 text-lg font-bold text-slate-900">Budget</h2>
                {budget && budget.budget_id !== null ? (
                  <div className="space-y-3">
                    <p className="text-slate-700">{money(budget.available)} left of {money(budget.allocated)}</p>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-orange-100" role="progressbar" aria-valuenow={Math.round(budget.percent_used)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500" style={{ width: `${Math.min(100, budget.percent_used)}%` }} />
                    </div>
                    <p className="text-sm text-slate-500">{budget.period_label}</p>
                  </div>
                ) : (
                  <p className="text-slate-500">No budget has been set for this lab yet.</p>
                )}
              </section>
            )}
          </div>
        </>
      )}
      {!stats && !loading && !error && <EmptyState title="Nothing to show yet" />}
    </div>
  );
};
