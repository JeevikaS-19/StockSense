import React, { useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client.ts';
import { PurchaseOrderDetail } from '../../types/index.ts';
import { Modal } from '../common/Modal.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, ErrorBanner } from '../common/Field.tsx';
import { useToast } from '../common/Toast.tsx';
import { quantity } from '../../lib/format.ts';

const REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'short', label: 'Short delivery' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'other', label: 'Other' },
];

interface Line {
  poItemId: number;
  description: string;
  unit: string;
  ordered: number;
  received: number;
  rejectedBefore: number;
  outstanding: number;
  accepted: string;
  rejected: string;
  reason: string;
  note: string;
}

// Goods receipt. Two steps: enter the delivery, then confirm a summary of what will change in stock.
export const ReceiveGoodsModal: React.FC<{ po: PurchaseOrderDetail; onClose: () => void; onReceived: () => void }> = ({ po, onClose, onReceived }) => {
  const { success, error: toastError } = useToast();
  const discrepancies = (po.invoices ?? []).filter((inv) => inv.comparison.discrepancy_count > 0);
  const [lines, setLines] = useState<Line[]>(() =>
    po.items
      .filter((item) => item.outstanding > 0)
      .map((item) => ({
        poItemId: item.id,
        description: item.description,
        unit: item.unit,
        ordered: item.qty_ordered,
        received: item.qty_received,
        rejectedBefore: item.qty_rejected,
        outstanding: item.outstanding,
        accepted: String(item.outstanding),
        rejected: '0',
        reason: '',
        note: '',
      }))
  );
  const [delivery, setDelivery] = useState('');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [saving, setSaving] = useState(false);

  const update = (id: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.poItemId === id ? { ...l, ...patch } : l)));

  const summary = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        acceptedNum: Number(line.accepted) || 0,
        rejectedNum: Number(line.rejected) || 0,
      })),
    [lines]
  );
  const totalAccepted = summary.reduce((sum, l) => sum + l.acceptedNum, 0);
  const totalRejected = summary.reduce((sum, l) => sum + l.rejectedNum, 0);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!delivery.trim()) next.delivery = 'Enter the delivery challan or invoice number.';
    let anything = false;
    for (const line of summary) {
      if (line.acceptedNum < 0 || line.rejectedNum < 0 || Number.isNaN(line.acceptedNum) || Number.isNaN(line.rejectedNum)) {
        next[`qty-${line.poItemId}`] = 'Quantities cannot be negative.';
      }
      if (line.acceptedNum + line.rejectedNum > 0) anything = true;
      if (line.acceptedNum + line.rejectedNum > line.outstanding + 1e-9) {
        next[`qty-${line.poItemId}`] = `Accepted plus rejected cannot exceed the ${quantity(line.outstanding)} ${line.unit} still outstanding.`;
      }
      if (line.rejectedNum > 0 && !line.reason) next[`reason-${line.poItemId}`] = 'Choose a reason for the rejected units.';
    }
    if (!anything) next.lines = 'Enter an accepted or rejected quantity for at least one line.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setSaving(true);
    try {
      await api.purchaseOrders.receive(po.id, {
        delivery_reference: delivery.trim(),
        received_at: receivedOn,
        note: note.trim(),
        lines: summary.map((line) => ({
          po_item_id: line.poItemId,
          qty_accepted: line.acceptedNum,
          qty_rejected: line.rejectedNum,
          reject_reason: line.rejectedNum > 0 ? line.reason : null,
          note: line.note,
        })),
      });
      success('Goods received. Stock and budget are updated.');
      onReceived();
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      setErrors((prev) => ({ ...prev, form: message }));
      toastError(message);
      setStep('enter');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Receive goods · ${po.po_number}`} description="Stock changes only when you confirm the receipt, never when the order was sent or an invoice arrived." maxWidth="2xl">
      {step === 'enter' ? (
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) setStep('confirm');
          }}
        >
          <ErrorBanner message={errors.form} />
          {discrepancies.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">The supplier invoice does not match this order.</p>
              {discrepancies.map((inv) => (
                <p key={inv.id} className="mt-1">
                  {inv.invoice_number || 'Invoice'}: {inv.comparison.summary}
                </p>
              ))}
              <p className="mt-1 text-amber-800">Check the quantities you are receiving against the delivery, not the invoice.</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Delivery reference" htmlFor="rc-ref" required error={errors.delivery} hint="Delivery challan or invoice number.">
              <input id="rc-ref" className={inputClass} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
            </Field>
            <Field label="Received on" htmlFor="rc-date">
              <input id="rc-date" type="date" className={inputClass} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </Field>
            <Field label="Note" htmlFor="rc-note">
              <input id="rc-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          {errors.lines && <p className="text-sm text-rose-600" role="alert">{errors.lines}</p>}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Accepted now</th>
                  <th className="px-3 py-2 text-right">Rejected</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={line.poItemId} className="align-top">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">{line.description}</p>
                      <p className="text-xs text-slate-500">Received so far: {quantity(line.received)} · Rejected so far: {quantity(line.rejectedBefore)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{quantity(line.ordered)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">{quantity(line.outstanding)}</td>
                    <td className="px-3 py-2.5">
                      <input aria-label={`Accepted for ${line.description}`} type="number" min={0} step="any" className={`${inputClass} w-24 text-right font-mono`} value={line.accepted} onChange={(e) => update(line.poItemId, { accepted: e.target.value })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <input aria-label={`Rejected for ${line.description}`} type="number" min={0} step="any" className={`${inputClass} w-24 text-right font-mono`} value={line.rejected} onChange={(e) => update(line.poItemId, { rejected: e.target.value })} />
                      {errors[`qty-${line.poItemId}`] && <p className="mt-1 text-xs text-rose-600">{errors[`qty-${line.poItemId}`]}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <select aria-label={`Reason for ${line.description}`} className={inputClass} value={line.reason} onChange={(e) => update(line.poItemId, { reason: e.target.value })} disabled={Number(line.rejected) <= 0}>
                        <option value="">Choose…</option>
                        {REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {errors[`reason-${line.poItemId}`] && <p className="mt-1 text-xs text-rose-600">{errors[`reason-${line.poItemId}`]}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary}>
              Review receipt
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Confirm this receipt</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono tabular-nums">{quantity(totalAccepted)}</span> units will be added to stock.
              </li>
              <li>
                <span className="font-mono tabular-nums">{quantity(totalRejected)}</span> units are rejected and will not be added to stock.
              </li>
              <li>Delivery reference {delivery.trim()} on {receivedOn}.</li>
            </ul>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {summary.map((line) => (
              <li key={line.poItemId} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-slate-800">{line.description}</span>
                <span className="whitespace-nowrap font-mono tabular-nums text-slate-700">
                  +{quantity(line.acceptedNum)} {line.unit}
                  {line.rejectedNum > 0 && <span className="text-rose-700"> · {quantity(line.rejectedNum)} rejected</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setStep('enter')} disabled={saving}>
              Back
            </button>
            <button type="button" className={buttonPrimary} onClick={submit} disabled={saving}>
              {saving ? 'Receiving…' : 'Confirm receipt'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
