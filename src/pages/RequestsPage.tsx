import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { RestockRequest } from '../types/index.ts';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { Chip } from '../components/common/StatusChip.tsx';
import { RestockRequestModal } from '../components/layout/RestockRequestModal.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { buttonPrimary, buttonSecondary, inputClass, ErrorBanner } from '../components/common/Field.tsx';
import { dateTime } from '../lib/format.ts';
import { Plus, Check } from 'lucide-react';

// Admins triage every request. Staff see only the requests they raised, with their status.
export const RequestsPage: React.FC = () => {
  const { user } = useAuth();
  const { activeLabId, activeLab, labs } = useLab();
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === 'admin';
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [requests, setRequests] = useState<RestockRequest[]>([]);
  const [status, setStatus] = useState('open');
  const [urgency, setUrgency] = useState('');
  const [filterLab, setFilterLab] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.requests
      .list({ lab_id: isAdmin ? (filterLab || (typeof activeLabId === 'number' ? activeLabId : '')) : '', status, urgency })
      .then((res) => setRequests(res.requests))
      .catch((err) => setError(errorMessage(err, 'Could not load restock requests.')))
      .finally(() => setLoading(false));
  }, [isAdmin, filterLab, activeLabId, status, urgency]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (request: RestockRequest) => {
    setResolvingId(request.id);
    try {
      await api.requests.resolve(request.id);
      success('Marked resolved. The requester has been told.');
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setResolvingId(null);
    }
  };

  const columns: Column<RestockRequest>[] = [
    {
      key: 'urgency',
      header: 'Urgency',
      render: (r) => (r.urgency === 'urgent' ? <Chip tone="rose">Urgent</Chip> : <Chip>Normal</Chip>),
    },
    {
      key: 'product',
      header: 'Product',
      render: (r) => (r.product_name ? <span><span className="font-medium text-slate-900">{r.product_name}</span> <span className="font-mono text-xs text-slate-500">{r.product_sku}</span></span> : <span className="text-slate-500">General request</span>),
    },
    { key: 'message', header: 'Message', render: (r) => <span className="line-clamp-2 max-w-md text-slate-700">{r.message}</span> },
    ...(isAdmin ? [{ key: 'by', header: 'Requested by', render: (r: RestockRequest) => <span className="text-sm">{r.requested_by_name}<span className="block text-xs text-slate-500">{r.lab_code}</span></span> } as Column<RestockRequest>] : []),
    { key: 'when', header: 'Raised', render: (r) => <span className="whitespace-nowrap text-xs text-slate-500">{dateTime(r.created_at)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.status === 'resolved' ? (
          <span className="text-sm text-emerald-700">
            <Check className="mr-1 inline h-3.5 w-3.5" />Resolved{r.resolved_by_name ? ` by ${r.resolved_by_name}` : ''}
          </span>
        ) : (
          <Chip tone="amber">Open</Chip>
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (r: RestockRequest) =>
              r.status === 'open' ? (
                <button type="button" className={buttonSecondary} onClick={() => resolve(r)} disabled={resolvingId === r.id}>
                  {resolvingId === r.id ? 'Saving…' : 'Mark resolved'}
                </button>
              ) : null,
          } as Column<RestockRequest>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Restock requests</h1>
          <p className="text-sm text-slate-500">
            {isAdmin ? 'Requests raised by staff across your laboratories.' : 'Requests you have raised, and whether they have been handled.'}
          </p>
        </div>
        {!isAdmin && labId !== null && (
          <button type="button" className={buttonPrimary} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New request
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select aria-label="Urgency" className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          <option value="">Any urgency</option>
          <option value="urgent">Urgent</option>
          <option value="normal">Normal</option>
        </select>
        {isAdmin && (
          <select aria-label="Laboratory" className={inputClass} value={filterLab} onChange={(e) => setFilterLab(e.target.value)}>
            <option value="">{activeLab ? `${activeLab.name}` : 'All laboratories'}</option>
            {labs.map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <ErrorBanner message={error} onRetry={load} />
      <DataTable
        columns={columns}
        rows={requests}
        rowKey={(r) => r.id}
        loading={loading}
        emptyTitle={status === 'open' ? 'No open requests' : 'No requests match these filters'}
        emptyText={isAdmin ? 'When staff ask for stock, the request appears here and in the bell.' : 'Use "Request restock" on a low-stock product, or the Contact admin button.'}
      />

      {creating && labId !== null && (
        <RestockRequestModal labId={labId} onClose={() => setCreating(false)} onCreated={load} />
      )}
    </div>
  );
};
