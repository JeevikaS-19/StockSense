import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { api, ApiError, errorMessage } from '../api/client.ts';
import { PurchaseOrderDetail } from '../types/index.ts';
import { useToast } from '../components/common/Toast.tsx';
import { Modal } from '../components/common/Modal.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, buttonDanger, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { PoStatusChip, Chip } from '../components/common/StatusChip.tsx';
import { ReceiveGoodsModal } from '../components/purchase/ReceiveGoodsModal.tsx';
import { InvoicePanel } from '../components/purchase/InvoicePanel.tsx';
import { money, quantity, dateTime, dateOnly, humanize } from '../lib/format.ts';
import { Printer, Copy, Check, Send, Mail } from 'lucide-react';

type Dialog = null | 'reject' | 'cancel' | 'close' | 'receive' | 'email' | 'fit';

interface FitLine {
  id: number;
  description: string;
  line_total: number;
}

interface FitPlan {
  summary: string;
  explanation: string;
  plan: { included: FitLine[]; excluded: FitLine[]; available: number; fits: boolean };
}

// Single text-reason dialog used for reject, cancel and close.
const ReasonDialog: React.FC<{ title: string; label: string; confirmLabel: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }> = ({ title, label, confirmLabel, danger, busy, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  return (
    <Modal isOpen onClose={onCancel} title={title} maxWidth="md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length >= 3) onConfirm(reason.trim());
        }}
      >
        <Field label={label} htmlFor="reason-text" required hint="At least 3 characters. It is kept in the audit log.">
          <textarea id="reason-text" rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onCancel}>
            Back
          </button>
          <button type="submit" className={danger ? buttonDanger : buttonPrimary} disabled={busy || reason.trim().length < 3}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const STEPS = ['draft', 'pending_approval', 'approved', 'sent', 'received'] as const;

export const PurchaseOrderDetailPage: React.FC = () => {
  const { id } = useParams();
  const poId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fit, setFit] = useState<FitPlan | null>(null);
  const [fitBusy, setFitBusy] = useState(false);
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === 'admin';

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [overrideShortfall, setOverrideShortfall] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [copied, setCopied] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string; source: string } | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!Number.isInteger(poId)) {
      setError('This purchase order link is not valid.');
      setLoading(false);
      return Promise.resolve();
    }
    setError(null);
    return api.purchaseOrders
      .get(poId)
      .then((res) => setPo(res.purchase_order))
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'This purchase order does not exist or you cannot see it.' : errorMessage(err, 'Could not load this purchase order.')))
      .finally(() => setLoading(false));
  }, [poId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const act = async (action: string, body: Record<string, unknown> = {}, message?: string) => {
    if (!po) return false;
    setBusy(true);
    try {
      const res = await api.purchaseOrders.action(po.id, action, body);
      setPo(res.purchase_order);
      if (message) success(message);
      return true;
    } catch (err) {
      toastError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const approve = async (override = false, reason?: string) => {
    if (!po) return;
    setBusy(true);
    try {
      const res = await api.purchaseOrders.action(po.id, 'approve', override ? { override: true, reason } : {});
      setPo(res.purchase_order);
      setDialog(null);
      setOverrideShortfall(null);
      success(override ? 'Approved over budget. The override is recorded in the audit log.' : 'Approved. The amount is committed against the budget.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BUDGET_EXCEEDED') {
        setOverrideShortfall(Number(err.details.shortfall ?? 0));
        setDialog(null);
      } else {
        toastError(errorMessage(err));
        setDialog(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (await act('send', {}, 'Sent to the supplier. Copy the supplier link below if they do not receive the email.')) {
      setDialog(null);
    }
  };

  const copyLink = async () => {
    if (!po) return;
    try {
      await navigator.clipboard.writeText(po.supplier_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError('Copy did not work in this browser. Select the link and copy it manually.');
    }
  };

  const openEmailDraft = async () => {
    if (!po) return;
    setDialog('email');
    setEmailNotice(null);
    try {
      setEmailDraft(await api.ai.emailDraft(po.id));
    } catch (err) {
      setEmailNotice(errorMessage(err));
    }
  };

  const sendEmailDraft = async () => {
    if (!po || !emailDraft) return;
    try {
      const res = await api.ai.emailSend({ po_id: po.id, subject: emailDraft.subject, body: emailDraft.body });
      setEmailNotice(res.sent ? 'Email sent to the supplier.' : res.reason ?? 'Email is not configured. Copy the message and send it from your mail client.');
    } catch (err) {
      setEmailNotice(errorMessage(err));
    }
  };

  if (loading) return <PageLoading label="Loading purchase order" />;
  if (error || !po) return <EmptyState title="Purchase order unavailable" text={error ?? 'It could not be found.'} action={<Link to="/purchase-orders" className={buttonSecondary}>Back to purchase orders</Link>} />;

  const isOpen = ['sent', 'partially_received'].includes(po.status);
  const stepIndex = STEPS.indexOf(po.status as (typeof STEPS)[number]);
  const totalOrdered = po.items.reduce((sum, i) => sum + i.qty_ordered, 0);
  const totalHandled = po.items.reduce((sum, i) => sum + i.qty_received + i.qty_rejected, 0);
  const progress = totalOrdered > 0 ? Math.min(100, (totalHandled / totalOrdered) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link to="/purchase-orders" className="text-sm text-slate-500 hover:text-slate-800">← Purchase orders</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-slate-900">{po.po_number}</h1>
            <PoStatusChip status={po.status} />
            {po.source === 'auto' && <Chip>Created by reorder rules</Chip>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {po.supplier_name} · {po.lab_name} ({po.lab_code}) · Created {dateOnly(po.created_at)} by {po.created_by_name ?? 'the system'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <Link to={`/purchase-orders/${po.id}/print`} className={buttonSecondary}>
            <Printer className="h-4 w-4" /> Print / PDF
          </Link>
          {po.status === 'draft' && (
            <>
              <Link to={`/purchase-orders/${po.id}/edit`} className={buttonSecondary}>Edit draft</Link>
              {po.total > po.budget_impact.available_now && (
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={fitBusy}
                  onClick={async () => {
                    setFitBusy(true);
                    try {
                      const res = await api.ai.fitPreview(po.id);
                      setFit(res);
                      setDialog('fit');
                    } catch (err) {
                      toastError(errorMessage(err));
                    } finally {
                      setFitBusy(false);
                    }
                  }}
                >
                  Fit to budget
                </button>
              )}
              <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act('submit', {}, 'Sent for approval.')}>
                Submit for approval
              </button>
            </>
          )}
          {po.status === 'pending_approval' && isAdmin && (
            <>
              <button type="button" className={buttonSecondary} onClick={() => setDialog('reject')} disabled={busy}>Reject</button>
              <button type="button" className={buttonPrimary} onClick={() => approve()} disabled={busy}>Approve</button>
            </>
          )}
          {po.status === 'approved' && isAdmin && (
            <button type="button" className={buttonPrimary} onClick={() => setDialog('email')} disabled={busy} title="Review the supplier message, then send the order">
              <Send className="h-4 w-4" /> Send to supplier
            </button>
          )}
          {isOpen && (
            <button type="button" className={buttonPrimary} onClick={() => setDialog('receive')}>
              Receive goods
            </button>
          )}
          {po.status === 'partially_received' && isAdmin && (
            <button type="button" className={buttonSecondary} onClick={() => setDialog('close')} disabled={busy}>Close short</button>
          )}
          {['draft', 'pending_approval'].includes(po.status) || (po.status === 'approved' && isAdmin) ? (
            <button type="button" className={buttonSecondary} onClick={() => setDialog('cancel')} disabled={busy}>Cancel order</button>
          ) : null}
        </div>
      </div>

      {overrideShortfall !== null && (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-950">Over budget by {money(overrideShortfall)}</p>
          <p className="text-sm text-amber-900">You can still approve this order. Write the reason; it is recorded permanently in the audit log and flagged on the Exceptions report.</p>
          <Field label="Reason for overriding the budget" htmlFor="override-reason" required>
            <textarea id="override-reason" rows={2} className={inputClass} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setOverrideShortfall(null)}>Not now</button>
            <button type="button" className={buttonDanger} disabled={overrideReason.trim().length < 5 || busy} onClick={() => approve(true, overrideReason.trim())}>
              Approve over budget
            </button>
          </div>
        </div>
      )}

      {(po.rejection_reason || po.cancel_reason || po.close_reason) && (
        <ErrorBanner message={`${po.status === 'rejected' ? 'Rejected' : po.status === 'cancelled' ? 'Cancelled' : 'Closed'}: ${po.rejection_reason ?? po.cancel_reason ?? po.close_reason}`} />
      )}

      <ol className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 text-xs sm:grid-cols-5" aria-label="Order progress">
        {STEPS.map((step, index) => {
          const done = stepIndex >= 0 && index <= stepIndex;
          return (
            <li key={step} className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${done ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className={done ? 'font-medium text-slate-900' : 'text-slate-500'}>{humanize(step)}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5 text-right">Ordered</th>
                    <th className="px-4 py-2.5 text-right">Received</th>
                    <th className="px-4 py-2.5 text-right">Rejected</th>
                    <th className="px-4 py-2.5 text-right">Outstanding</th>
                    <th className="px-4 py-2.5 text-right">Unit price</th>
                    <th className="px-4 py-2.5 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {po.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{item.description}</p>
                        <p className="text-xs text-slate-500">On hand {quantity(item.on_hand)} {item.unit} · {item.lead_time_days} day lead time</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{quantity(item.qty_ordered)} {item.unit}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{quantity(item.qty_received)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{item.qty_rejected > 0 ? quantity(item.qty_rejected) : '—'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">{quantity(item.outstanding)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{money(item.unit_price)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-right font-medium text-slate-700">Order total</td>
                    <td className="px-4 py-3 text-right font-mono text-base font-semibold tabular-nums">{money(po.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {['sent', 'partially_received', 'received', 'closed'].includes(po.status) && (
              <div className="border-t border-slate-200 px-4 py-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>Delivered or rejected</span>
                  <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-indigo-600" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </section>

          <InvoicePanel po={po} isAdmin={isAdmin} onChanged={load} />

          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Goods receipts</h2>
            {po.receipts.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {po.receipts.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <Link to={`/receipts/${r.id}`} className="font-mono font-medium text-indigo-700 hover:text-indigo-900">{r.receipt_no}</Link>
                    <span className="text-slate-600">
                      {dateTime(r.received_at)} · {r.delivery_reference || 'No reference'} · {r.received_by_name ?? 'Unknown'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-2">
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Budget impact</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Available now</dt>
                <dd className="font-mono tabular-nums">{money(po.budget_impact.available_now)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">This order</dt>
                <dd className="font-mono tabular-nums">{money(po.budget_impact.po_total)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <dt className="font-medium text-slate-700">Available after</dt>
                <dd className={`font-mono font-semibold tabular-nums ${po.budget_impact.available_after < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(po.budget_impact.available_after)}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              {po.budget_impact.reserves_budget ? 'Approval reserves this amount in the lab budget.' : 'The amount is already committed or spent in the budget.'}
            </p>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Supplier</h2>
            <p className="font-medium text-slate-900">{po.supplier_name}</p>
            <p className="text-sm text-slate-600">{po.supplier_contact}</p>
            {po.supplier_email && <p className="text-sm text-slate-600">{po.supplier_email}</p>}
            {po.supplier_phone && <p className="text-sm text-slate-600">{po.supplier_phone}</p>}
            <p className="text-sm text-slate-500">Expected delivery: {po.expected_date ? dateOnly(po.expected_date) : 'set when sent'}</p>
            {po.supplier_confirmed_at && <Chip tone="emerald">Confirmed by supplier {dateTime(po.supplier_confirmed_at)}</Chip>}
            {po.status !== 'draft' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-500">Supplier link</p>
                <div className="flex gap-2">
                  <input readOnly aria-label="Supplier link" value={po.supplier_link} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copyLink} className={buttonSecondary} aria-label="Copy supplier link">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            {isAdmin && ['approved', 'sent', 'partially_received'].includes(po.status) && (
              <button type="button" onClick={openEmailDraft} className={`${buttonSecondary} w-full`}>
                <Mail className="h-4 w-4" /> Draft message to supplier
              </button>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
            {po.activity.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {po.activity.slice(0, 20).map((entry) => (
                  <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-slate-900">{humanize(entry.action.replace(/^[a-z_]+\./, ''))}</p>
                    <p className="text-xs text-slate-500">
                      {entry.actor_name ?? 'System'} · {dateTime(entry.created_at)}
                      {entry.new_value?.override ? ' · budget override' : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {dialog === 'reject' && (
        <ReasonDialog title="Reject order" label="Why is this order rejected?" confirmLabel="Reject order" danger busy={busy} onCancel={() => setDialog(null)} onConfirm={(reason) => act('reject', { reason }, 'Order rejected. The creator has been told why.').then((ok) => ok && setDialog(null))} />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog title="Cancel order" label="Why is this order being cancelled?" confirmLabel="Cancel order" danger busy={busy} onCancel={() => setDialog(null)} onConfirm={(reason) => act('cancel', { reason }, 'Order cancelled.').then((ok) => ok && setDialog(null))} />
      )}
      {dialog === 'close' && (
        <ReasonDialog title="Close short" label="Why are the remaining items not coming?" confirmLabel="Close order" danger busy={busy} onCancel={() => setDialog(null)} onConfirm={(reason) => act('close', { reason }, 'Order closed. The unreceived amount is released from the budget.').then((ok) => ok && setDialog(null))} />
      )}
      {dialog === 'receive' && <ReceiveGoodsModal po={po} onClose={() => setDialog(null)} onReceived={load} />}
      {dialog === 'fit' && fit && (
        <Modal isOpen onClose={() => setDialog(null)} title="Fit to budget" description={fit.summary} maxWidth="lg">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Available: <span className="font-mono">{money(fit.plan.available)}</span>. Lines most at risk of running out are kept first.
            </p>
            {fit.explanation && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{fit.explanation}</p>}
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-700">Kept on this order</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {fit.plan.included.length === 0 && <li className="px-3 py-2 text-slate-500">Nothing fits the budget.</li>}
                {fit.plan.included.map((l) => (
                  <li key={l.id} className="flex justify-between px-3 py-2"><span>{l.description}</span><span className="font-mono">{money(l.line_total)}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700">Moved to a new draft</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {fit.plan.excluded.length === 0 && <li className="px-3 py-2 text-slate-500">Nothing to move.</li>}
                {fit.plan.excluded.map((l) => (
                  <li key={l.id} className="flex justify-between px-3 py-2"><span>{l.description}</span><span className="font-mono">{money(l.line_total)}</span></li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" className={buttonSecondary} onClick={() => setDialog(null)}>Cancel</button>
              <button
                type="button"
                className={buttonPrimary}
                disabled={fitBusy || fit.plan.included.length === 0 || fit.plan.excluded.length === 0}
                onClick={async () => {
                  setFitBusy(true);
                  try {
                    const res = await api.ai.fitConfirm(po.id, fit.plan.included.map((l) => l.id));
                    success('Lines moved. The remainder is a new draft order.');
                    setDialog(null);
                    navigate(`/purchase-orders/${res.moved_to}`);
                  } catch (err) {
                    toastError(errorMessage(err));
                  } finally {
                    setFitBusy(false);
                  }
                }}
              >
                Keep these lines and move the rest
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === 'email' && (
        <Modal isOpen onClose={() => setDialog(null)} title={po.status === 'approved' ? 'Send to supplier' : 'Supplier message'} description="Review the message. Nothing is sent until you press Send." maxWidth="lg">
          <div className="space-y-4">
            {!emailDraft && !emailNotice && <p className="text-sm text-slate-500">Preparing the message…</p>}
            {emailNotice && <ErrorBanner message={emailNotice} />}
            {emailDraft && (
              <>
                <Field label="Subject" htmlFor="mail-subject">
                  <input id="mail-subject" className={inputClass} value={emailDraft.subject} onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })} />
                </Field>
                <Field label="Message" htmlFor="mail-body">
                  <textarea id="mail-body" rows={10} className={`${inputClass} font-mono text-xs`} value={emailDraft.body} onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })} />
                </Field>
                <p className="text-xs text-slate-500">{emailDraft.source === 'gemini' ? 'Drafted with AI. Review before sending.' : 'Template draft.'}</p>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" className={buttonSecondary} onClick={() => emailDraft && navigator.clipboard.writeText(`${emailDraft.subject}\n\n${emailDraft.body}`).then(() => success('Message copied.'))} disabled={!emailDraft}>
                <Copy className="h-4 w-4" /> Copy
              </button>
              {po.status === 'approved' && isAdmin ? (
                <button type="button" className={buttonPrimary} disabled={busy} onClick={async () => {
                  await send();
                }}>
                  Mark as sent
                </button>
              ) : null}
              {emailDraft && <button type="button" className={buttonSecondary} onClick={sendEmailDraft}>Email supplier</button>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
