import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLab } from '../context/LabContext.tsx';
import { api, ApiError, errorMessage } from '../api/client.ts';
import { Product, Transaction } from '../types/index.ts';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { ArrowDownLeft, ArrowUpRight, PackageCheck, AlertCircle, Clock } from 'lucide-react';
import { dateTime, quantity, money } from '../lib/format.ts';

// Records a stock in or out for one product. The server is the authority on available stock (409 INSUFFICIENT_STOCK);
// the client check only gives an earlier, friendlier message.
export const StockMovementPage: React.FC = () => {
  const { activeLabId, activeLab, labs, setActiveLabId } = useLab();
  const { success, error: toastError } = useToast();
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productId, setProductId] = useState<number | ''>('');
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [quantityText, setQuantityText] = useState('');
  const [party, setParty] = useState('');
  const [note, setNote] = useState('');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<Transaction[]>([]);

  const selected = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);

  const loadRecent = useCallback(() => {
    if (labId === null) return;
    api.transactions
      .list({ lab_id: labId, limit: 6 })
      .then((res) => setRecent(res.transactions))
      .catch(() => setRecent([]));
  }, [labId]);

  // Every lab change starts from a clean slate: no product, quantity or party carried over from the previous lab.
  useEffect(() => {
    setProductId('');
    setQuantityText('');
    setParty('');
    setNote('');
    setQuantityError(null);
    setSubmitError(null);
    setProducts([]);
    if (labId === null) return;
    let cancelled = false;
    setLoadingProducts(true);
    api.products
      .list({ lab_id: labId, limit: 100, sort_by: 'name' })
      .then((res) => {
        if (cancelled) return;
        setProducts(res.products);
        if (res.products.length > 0) setProductId(res.products[0].id);
      })
      .catch((err) => !cancelled && setSubmitError(errorMessage(err, 'Could not load products.')))
      .finally(() => !cancelled && setLoadingProducts(false));
    loadRecent();
    return () => {
      cancelled = true;
    };
  }, [labId, loadRecent]);

  // Default the supplier name for stock in from the product's preferred supplier.
  useEffect(() => {
    if (type === 'IN' && selected?.supplier_name && !party) setParty(selected.supplier_name);
  }, [selected, type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (labId === null) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <EmptyState
          title={activeLabId === 'all' ? 'Choose a laboratory to record stock' : 'No laboratory assigned'}
          text={activeLabId === 'all' ? 'Stock moves are recorded against one physical lab. Pick one below.' : 'Ask your administrator to add you to a laboratory.'}
          action={
            activeLabId === 'all' ? (
              <div className="grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                {labs.map((lab) => (
                  <button key={lab.id} type="button" onClick={() => setActiveLabId(lab.id)} className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-indigo-400">
                    <span className="block text-sm font-medium text-slate-900">{lab.name}</span>
                    <span className="block text-xs text-slate-500">{lab.department}</span>
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>
    );
  }

  const validate = (): boolean => {
    const numeric = Number(quantityText);
    if (!quantityText || Number.isNaN(numeric) || numeric <= 0) {
      setQuantityError('Enter a quantity greater than zero.');
      return false;
    }
    if (type === 'OUT' && selected && numeric > selected.quantity) {
      setQuantityError(`Only ${quantity(selected.quantity)} ${selected.unit} available in stock. Cannot issue ${quantity(numeric)}.`);
      return false;
    }
    if (!party.trim()) {
      setSubmitError(`Enter the ${type === 'IN' ? 'supplier' : 'recipient'}.`);
      return false;
    }
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuantityError(null);
    setSubmitError(null);
    if (!selected || !validate()) return;
    setSubmitting(true);
    try {
      const res = await api.stock.move({
        lab_id: labId,
        product_id: selected.id,
        type,
        quantity: Number(quantityText),
        party: party.trim(),
        note: note.trim(),
      });
      success(`${type === 'IN' ? 'Received' : 'Issued'} ${quantity(Number(quantityText))} ${selected.unit} of ${selected.name}. On hand is now ${quantity(res.product.current_quantity)}.`);
      setQuantityText('');
      setNote('');
      setParty(type === 'IN' ? selected.supplier_name ?? '' : '');
      const refreshed = await api.products.list({ lab_id: labId, limit: 100, sort_by: 'name' });
      setProducts(refreshed.products);
      loadRecent();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setQuantityError(err.message);
      } else {
        const message = errorMessage(err);
        setSubmitError(message);
        toastError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Stock in and out</h1>
        <p className="text-sm text-slate-500">{activeLab?.name} · Each movement is recorded and cannot be edited afterwards.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-2" noValidate>
          <ErrorBanner message={submitError} />

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Movement</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['IN', 'OUT'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={type === value}
                  onClick={() => {
                    setType(value);
                    setQuantityError(null);
                    setParty(value === 'IN' ? selected?.supplier_name ?? '' : '');
                  }}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${type === value ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-md ${value === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {value === 'IN' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{value === 'IN' ? 'Stock in' : 'Stock out'}</span>
                    <span className="block text-xs text-slate-500">{value === 'IN' ? 'Received from a supplier' : 'Issued to a student or group'}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Product" htmlFor="sm-product" required hint={loadingProducts ? 'Loading products…' : products.length === 0 ? 'No products in this lab yet. Add one on the Products page.' : undefined}>
            <select id="sm-product" className={inputClass} value={productId} disabled={loadingProducts || products.length === 0} onChange={(e) => {
              setProductId(e.target.value ? Number(e.target.value) : '');
              setQuantityError(null);
            }}>
              {products.length === 0 && <option value="">No products</option>}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} — {quantity(p.quantity)} {p.unit}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Quantity to ${type === 'IN' ? 'receive' : 'issue'}`} htmlFor="sm-qty" required error={quantityError}>
              <div className="relative">
                <input
                  id="sm-qty"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  className={`${inputClass} pr-16 font-mono ${quantityError ? 'border-rose-400' : ''}`}
                  value={quantityText}
                  onChange={(e) => {
                    setQuantityText(e.target.value);
                    setQuantityError(null);
                  }}
                  aria-invalid={quantityError ? true : undefined}
                />
                {selected && <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">{selected.unit}</span>}
              </div>
            </Field>
            <Field label={type === 'IN' ? 'Supplier' : 'Issued to'} htmlFor="sm-party" required>
              <input
                id="sm-party"
                className={inputClass}
                value={party}
                onChange={(e) => setParty(e.target.value)}
                placeholder={type === 'IN' ? 'Supplier name or order reference' : 'Student, group or project'}
              />
            </Field>
          </div>

          <Field label="Note" htmlFor="sm-note" hint="Optional: experiment reference, grant code or reason.">
            <textarea id="sm-note" rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <button type="submit" disabled={submitting || !selected} className={`${buttonPrimary} w-full py-2.5`}>
            <PackageCheck className="h-4 w-4" />
            {submitting ? 'Recording…' : type === 'IN' ? 'Record stock in' : 'Record stock out'}
          </button>
        </form>

        <aside className="space-y-6">
          {selected && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Selected product</p>
              <h2 className="mt-1 text-sm font-semibold text-slate-900">{selected.name}</h2>
              <p className="font-mono text-xs text-slate-500">{selected.sku}</p>
              <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">On hand</dt>
                  <dd className="font-mono tabular-nums font-semibold text-slate-900">{quantity(selected.quantity)} {selected.unit}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Reorder point</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{quantity(selected.reorder_level)} {selected.unit}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">On order</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{selected.on_order > 0 ? quantity(selected.on_order) : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Unit cost</dt>
                  <dd className="font-mono tabular-nums text-slate-700">{money(selected.unit_price)}</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-1.5 text-slate-700">
              <Clock className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Recent movements</h2>
            </div>
            {recent.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <AlertCircle className="h-4 w-4 text-slate-400" /> Nothing recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((tx) => (
                  <li key={tx.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-slate-800">{tx.product_name}</span>
                      <span className={`font-mono tabular-nums font-semibold ${tx.type === 'IN' ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {tx.type === 'IN' ? '+' : '−'}{quantity(tx.quantity)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="truncate">{tx.party}</span>
                      <span className="whitespace-nowrap">{dateTime(tx.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
