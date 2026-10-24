import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { BudgetSummary, Pagination } from '../types/index.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { KpiCard } from '../components/common/KpiCard.tsx';
import { Modal } from '../components/common/Modal.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Wallet, PiggyBank, Lock, Layers, CalendarClock, Pencil } from 'lucide-react';
import { money, percent, dateOnly, dateTime } from '../lib/format.ts';

interface LedgerEntry {
  id: number;
  entry_type: 'commit' | 'release' | 'spend' | 'adjustment';
  amount: number;
  note: string;
  created_at: string;
  po_id: number | null;
  po_number: string | null;
  user_name: string | null;
}

const ENTRY_LABEL: Record<string, string> = { commit: 'Committed', release: 'Released', spend: 'Spent', adjustment: 'Adjustment' };

export const BudgetPage: React.FC = () => {
  const { user } = useAuth();
  const { activeLabId, activeLab } = useLab();
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === 'admin';
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 15, total_pages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ period_label: '', start_date: '', end_date: '', allocated: '' });
  const [formError, setFormError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (labId === null) return;
    setLoading(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([api.budgets.summary(labId), api.budgets.ledger({ lab_id: labId, page: pagination.page, limit: pagination.limit })]);
      setSummary(s.summary);
      setEntries(l.entries);
      setPagination(l.pagination);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the budget.'));
    } finally {
      setLoading(false);
    }
  }, [labId, pagination.page, pagination.limit]);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [labId]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = () => {
    setForm({
      period_label: summary?.period_label ?? '',
      start_date: summary?.start_date ?? '',
      end_date: summary?.end_date ?? '',
      allocated: summary?.allocated ? String(summary.allocated) : '',
    });
    setFormError({});
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (labId === null) return;
    const errors: Record<string, string> = {};
    if (form.period_label.trim().length < 3) errors.period_label = 'Name the period, for example 2026-27 Odd Semester.';
    if (!form.start_date) errors.start_date = 'Choose a start date.';
    if (!form.end_date) errors.end_date = 'Choose an end date.';
    if (form.start_date && form.end_date && form.end_date < form.start_date) errors.end_date = 'The end date must be on or after the start date.';
    if (form.allocated === '' || Number(form.allocated) < 0) errors.allocated = 'Enter the allocation in rupees.';
    setFormError(errors);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const res = await api.budgets.update({ lab_id: labId, period_label: form.period_label.trim(), start_date: form.start_date, end_date: form.end_date, allocated: Number(form.allocated) });
      setSummary(res.summary);
      success('Budget saved.');
      setEditing(false);
      load();
    } catch (err) {
      const message = errorMessage(err);
      setFormError({ form: message });
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  if (labId === null) {
    return <EmptyState title={activeLabId === 'all' ? 'Choose a laboratory' : 'No laboratory assigned'} text="Each laboratory has its own budget. Pick one from the switcher." />;
  }
  if (loading && !summary) return <PageLoading label="Loading budget" />;

  const used = summary ? summary.committed + summary.spent : 0;
  const pct = (value: number) => (summary && summary.allocated > 0 ? Math.max(0, (value / summary.allocated) * 100) : 0);
  const tone = summary && summary.percent_used >= 90 ? 'rose' : summary && summary.percent_used >= 75 ? 'amber' : 'default';

  const columns: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Date', render: (e) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.created_at)}</span> },
    { key: 'type', header: 'Type', render: (e) => <span className="text-sm font-medium text-slate-800">{ENTRY_LABEL[e.entry_type]}</span> },
    { key: 'po', header: 'Order', render: (e) => (e.po_number ? <span className="font-mono text-xs">{e.po_number}</span> : <span className="text-slate-400">—</span>) },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (e) => <span className={`font-mono tabular-nums font-semibold ${e.entry_type === 'release' ? 'text-slate-500' : 'text-slate-900'}`}>{e.entry_type === 'release' ? '−' : ''}{money(e.amount)}</span>,
    },
    { key: 'note', header: 'Note', render: (e) => <span className="text-xs text-slate-600">{e.note || '—'}</span> },
    { key: 'user', header: 'By', render: (e) => <span className="text-xs text-slate-500">{e.user_name ?? 'System'}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Budget</h1>
          <p className="text-sm text-slate-500">
            {activeLab?.name} · {summary?.period_label ?? 'No period set'}
            {summary?.start_date && summary?.end_date ? ` · ${dateOnly(summary.start_date)} to ${dateOnly(summary.end_date)}` : ''}
          </p>
        </div>
        {isAdmin && (
          <button type="button" className={buttonSecondary} onClick={openEdit}>
            <Pencil className="h-4 w-4" /> {summary?.budget_id ? 'Edit allocation' : 'Set budget'}
          </button>
        )}
      </div>

      <ErrorBanner message={error} onRetry={load} />

      {summary && summary.budget_id === null && (
        <EmptyState title="No budget set for this laboratory" text={isAdmin ? 'Set the allocation for the period. Purchase orders cannot be approved until it is set.' : 'Your administrator sets the budget.'} action={isAdmin ? <button type="button" className={buttonPrimary} onClick={openEdit}>Set budget</button> : undefined} />
      )}

      {summary && summary.budget_id !== null && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Allocated" value={money(summary.allocated)} icon={Wallet} subtext="For this period" />
            <KpiCard label="Committed" value={money(summary.committed)} icon={Lock} subtext="Approved, not yet received" />
            <KpiCard label="Spent" value={money(summary.spent)} icon={PiggyBank} subtext="Received and accounted" />
            <KpiCard label="Available" value={money(summary.available)} icon={Layers} variant={summary.available < 0 ? 'rose' : 'default'} subtext={`${percent(summary.percent_used)} used`} />
          </div>

          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-sm">
              <h2 className="font-semibold text-slate-900">Use of allocation</h2>
              <span className={`font-mono tabular-nums font-semibold ${tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{percent(summary.percent_used)}</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Spent ${money(summary.spent)}, committed ${money(summary.committed)}, available ${money(summary.available)}`}>
              <div className="h-full bg-slate-700" style={{ width: `${pct(summary.spent)}%` }} title="Spent" />
              <div className="h-full bg-indigo-400" style={{ width: `${pct(summary.committed)}%` }} title="Committed" />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-700" /> Spent</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" /> Committed</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-300" /> Available ({money(Math.max(0, summary.available))})</span>
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Burn rate</p>
                <p className="font-mono tabular-nums">{money(summary.burn_rate_per_day)} / day</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><CalendarClock className="h-3 w-3" /> Projected to run out</p>
                <p className="font-mono tabular-nums">{summary.available <= 0 ? 'Already used up' : summary.projected_exhaustion_date ? dateOnly(summary.projected_exhaustion_date) : 'Not at current rate'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Used so far</p>
                <p className="font-mono tabular-nums">{money(used)}</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Ledger</h2>
            <p className="text-xs text-slate-500">Entries are added automatically on approval, receipt, cancellation and close. They cannot be edited.</p>
            <DataTable
              columns={columns}
              rows={entries}
              rowKey={(e) => e.id}
              loading={loading && entries.length === 0}
              emptyTitle="No ledger entries yet"
              emptyText="Approving a purchase order records the first commitment."
              footer={
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{pagination.total} entries</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className={buttonSecondary} disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}>Previous</button>
                    <span className="font-mono tabular-nums">{pagination.page} / {pagination.total_pages}</span>
                    <button type="button" className={buttonSecondary} disabled={pagination.page >= pagination.total_pages} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}>Next</button>
                  </div>
                </div>
              }
            />
          </section>
        </>
      )}

      <Modal isOpen={editing} onClose={() => setEditing(false)} title={summary?.budget_id ? 'Edit budget' : 'Set budget'} description="Changing the allocation adjusts available funds immediately. It cannot go below what is already committed or spent.">
        <form onSubmit={save} className="space-y-4" noValidate>
          <ErrorBanner message={formError.form} />
          <Field label="Period" htmlFor="b-period" required error={formError.period_label}>
            <input id="b-period" className={inputClass} value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} placeholder="2026-27 Odd Semester" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="b-start" required error={formError.start_date}>
              <input id="b-start" type="date" className={inputClass} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="End date" htmlFor="b-end" required error={formError.end_date}>
              <input id="b-end" type="date" className={inputClass} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </Field>
          </div>
          <Field label="Allocation (₹)" htmlFor="b-alloc" required error={formError.allocated}>
            <input id="b-alloc" type="number" min={0} step="0.01" className={`${inputClass} font-mono`} value={form.allocated} onChange={(e) => setForm({ ...form, allocated: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className={buttonPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save budget'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
