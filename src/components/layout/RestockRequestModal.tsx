import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client.ts';
import { Modal } from '../common/Modal.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary } from '../common/Field.tsx';
import { useToast } from '../common/Toast.tsx';
import { Product } from '../../types/index.ts';

interface Props {
  labId: number;
  productId?: number | null;
  onClose: () => void;
  onCreated?: () => void;
}

// Staff ask the lab head for stock. Used from the "Contact admin" button and from low-stock rows.
export const RestockRequestModal: React.FC<Props> = ({ labId, productId = null, onClose, onCreated }) => {
  const { success, error: toastError } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [chosenProduct, setChosenProduct] = useState<number | ''>(productId ?? '');
  const [message, setMessage] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.products
      .list({ lab_id: labId, limit: 100, sort_by: 'name' })
      .then((res) => setProducts(res.products))
      .catch(() => setProducts([]));
  }, [labId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 5) {
      setError('Describe what is needed (at least 5 characters).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.requests.create({ lab_id: labId, product_id: chosenProduct === '' ? null : chosenProduct, message: message.trim(), urgency });
      success('Request sent to the lab administrator.');
      onCreated?.();
      onClose();
    } catch (err) {
      const text = errorMessage(err);
      setError(text);
      toastError(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Request restock" description="The lab administrator is notified straight away.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product" htmlFor="restock-product" hint="Optional. Leave empty for a general request.">
          <select id="restock-product" className={inputClass} value={chosenProduct} onChange={(e) => setChosenProduct(e.target.value ? Number(e.target.value) : '')}>
            <option value="">General request</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name} ({p.quantity} {p.unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is needed" htmlFor="restock-message" required error={error}>
          <textarea id="restock-message" rows={3} className={inputClass} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: Resistors are almost gone before Monday's practical." />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Urgency</legend>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="radio" name="urgency" checked={urgency === 'normal'} onChange={() => setUrgency('normal')} /> Normal
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="urgency" checked={urgency === 'urgent'} onChange={() => setUrgency('urgent')} /> Urgent
            </label>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className={buttonSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonPrimary}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
