import React, { useEffect, useState } from 'react';
import { useLab } from '../context/LabContext.tsx';
import { api, downloadFile, errorMessage } from '../api/client.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { buttonSecondary, inputClass, ErrorBanner } from '../components/common/Field.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import { dateTime, humanize } from '../lib/format.ts';

interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  lab_id: number | null;
  lab_code: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_name: string | null;
}

const ENTITY_TYPES = ['purchase_order', 'goods_receipt', 'supplier_invoice', 'budget', 'product', 'lab', 'user', 'restock_request', 'invitation', 'setting', 'supplier', 'reorder', 'stock'];

// Read-only record of every change. Admin only. There is no way to edit or delete these rows.
export const AuditLogPage: React.FC = () => {
  const { labs } = useLab();
  const { error: toastError } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [lab, setLab] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const filters = () => ({ from, to, action, entity_type: entity, lab_id: lab });

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.audit
      .list(filters())
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(errorMessage(err, 'Could not load the audit log.')))
      .finally(() => setLoading(false));
  }, [from, to, action, entity, lab]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    const search = new URLSearchParams({ format: 'csv' });
    Object.entries(filters()).forEach(([k, v]) => v && search.set(k, String(v)));
    try {
      await downloadFile(`/api/audit?${search.toString()}`, 'audit-log.csv');
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.created_at)}</span> },
    { key: 'who', header: 'Who', render: (e) => e.actor_name ?? 'System' },
    { key: 'action', header: 'Action', render: (e) => <span className="font-mono text-xs text-slate-800">{e.action}</span> },
    { key: 'entity', header: 'Record', render: (e) => <span className="text-xs">{humanize(e.entity_type)} {e.entity_id ? `#${e.entity_id}` : ''}</span> },
    { key: 'lab', header: 'Lab', render: (e) => <span className="font-mono text-xs">{e.lab_code ?? '—'}</span> },
    {
      key: 'details',
      header: <span className="sr-only">Details</span>,
      align: 'right',
      render: (e) => (
        <button type="button" className="text-indigo-600 hover:text-indigo-800" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
          {open === e.id ? <ChevronDown className="inline h-4 w-4" /> : <ChevronRight className="inline h-4 w-4" />} View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Audit log</h1>
          <p className="text-sm text-slate-500">Every change, who made it, and what it was before and after. Read-only.</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={exportCsv}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <input aria-label="From date" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input aria-label="To date" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        <input aria-label="Action starts with" className={inputClass} placeholder="Action, e.g. po.approve" value={action} onChange={(e) => setAction(e.target.value)} />
        <select aria-label="Record type" className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All record types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </select>
        <select aria-label="Laboratory" className={inputClass} value={lab} onChange={(e) => setLab(e.target.value)}>
          <option value="">All laboratories</option>
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner message={error} />
      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        loading={loading}
        emptyTitle="No changes match these filters"
        emptyText="Try a wider date range or clear the filters."
      />

      {open !== null && (
        <AuditDetail entry={entries.find((e) => e.id === open)} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};

const AuditDetail: React.FC<{ entry?: AuditEntry; onClose: () => void }> = ({ entry, onClose }) => {
  if (!entry) return null;
  return (
    <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
      <div className="md:col-span-2 flex items-center justify-between">
        <p className="font-mono text-sm font-medium text-slate-900">{entry.action}</p>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Before</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{entry.old_value ? JSON.stringify(entry.old_value, null, 2) : 'No previous value'}</pre>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">After</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{entry.new_value ? JSON.stringify(entry.new_value, null, 2) : 'No new value'}</pre>
      </div>
    </section>
  );
};
