import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Product, PurchaseOrderDetail, Supplier } from '../types/index.ts';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Plus, Trash2 } from 'lucide-react';
import { money, quantity } from '../lib/format.ts';

interface LineState {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

let lineKey = 0;
const newLine = (productId = '', qty = '', price = ''): LineState => ({ key: ++lineKey, productId, quantity: qty, unitPrice: price });

// Used for both creating a purchase order and editing a draft. Only drafts can be edited.
export const PurchaseOrderFormPage: React.FC = () => {
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { activeLabId, activeLab } = useLab();
  const { success, error: toastError } = useToast();
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [existing, setExisting] = useState<PurchaseOrderDetail | null>(null);

  useEffect(() => {
    api.suppliers.list().then((res) => setSuppliers(res.suppliers)).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    if (labId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const loads: Promise<unknown>[] = [api.products.list({ lab_id: labId, limit: 100, sort_by: 'name' }).then((res) => !cancelled && setProducts(res.products))];
    if (editingId !== null) {
      loads.push(
        api.purchaseOrders.get(editingId).then((res) => {
          if (cancelled) return;
          const po: PurchaseOrderDetail = res.purchase_order;
          if (po.status !== 'draft') {
            setLoadError('Only draft orders can be edited. This order has already been submitted.');
            return;
          }
          setExisting(po);
          setSupplierId(String(po.supplier_id));
          setNotes(po.notes ?? '');
          setLines(po.items.map((item) => newLine(String(item.product_id), String(item.qty_ordered), String(item.unit_price))));
        })
      );
    }
    Promise.all(loads)
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load this order.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [labId, editingId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const total = lines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  const update = (key: number, patch: Partial<LineState>) => setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const chooseProduct = (key: number, productIdText: string) => {
    const product = productById.get(Number(productIdText));
    update(key, { productId: productIdText, unitPrice: product ? String(product.unit_price) : '' });
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!supplierId) next.supplier = 'Choose a supplier.';
    const filled = lines.filter((line) => line.productId || line.quantity);
    if (filled.length === 0) next.lines = 'Add at least one item.';
    filled.forEach((line) => {
      if (!line.productId) next[`product-${line.key}`] = 'Choose a product.';
      if (!(Number(line.quantity) > 0)) next[`qty-${line.key}`] = 'Enter a quantity above zero.';
      if (line.unitPrice !== '' && Number(line.unitPrice) < 0) next[`price-${line.key}`] = 'Unit price cannot be negative.';
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (mode: 'draft' | 'submit') => {
    if (labId === null || !validate()) return;
    const payload = {
      notes: notes.trim(),
      lines: lines
        .filter((line) => line.productId)
        .map((line) => ({
          product_id: Number(line.productId),
          quantity: Number(line.quantity),
          unit_price: line.unitPrice === '' ? undefined : Number(line.unitPrice),
        })),
    };
    setSaving(mode);
    try {
      let poId: number;
      if (editingId !== null) {
        await api.purchaseOrders.update(editingId, payload);
        poId = editingId;
      } else {
        const res = await api.purchaseOrders.create({ lab_id: labId, supplier_id: Number(supplierId), ...payload });
        poId = res.purchase_order.id;
      }
      if (mode === 'submit') await api.purchaseOrders.action(poId, 'submit');
      success(mode === 'submit' ? 'Sent for approval.' : 'Draft saved.');
      navigate(`/purchase-orders/${poId}`);
    } catch (err) {
      const message = errorMessage(err);
      setErrors((prev) => ({ ...prev, form: message }));
      toastError(message);
    } finally {
      setSaving(null);
    }
  };

  if (labId === null) return <EmptyState title="Choose a laboratory" text="Purchase orders belong to one laboratory." />;
  if (loading) return <PageLoading label="Loading order" />;
  if (loadError) return <EmptyState title="This order cannot be edited" text={loadError} action={<Link to="/purchase-orders" className={buttonSecondary}>Back to purchase orders</Link>} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link to={existing ? `/purchase-orders/${existing.id}` : '/purchase-orders'} className="text-sm text-slate-500 hover:text-slate-800">
          ← {existing ? existing.po_number : 'Purchase orders'}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{existing ? `Edit ${existing.po_number}` : 'New purchase order'}</h1>
        <p className="text-sm text-slate-500">{activeLab?.name} · Save as a draft, then submit it for approval when it is ready.</p>
      </div>

      <ErrorBanner message={errors.form} />

      <form className="space-y-6" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
          <Field label="Supplier" htmlFor="po-supplier" required error={errors.supplier} hint="The supplier stays fixed once the order is submitted.">
            <select id="po-supplier" className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={existing !== null}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="po-notes" hint="Optional. Shown to the approver.">
            <input id="po-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Items</h2>
            <button type="button" className={buttonSecondary} onClick={() => setLines((prev) => [...prev, newLine()])}>
              <Plus className="h-4 w-4" /> Add item
            </button>
          </div>
          {errors.lines && <p className="text-sm text-rose-600" role="alert">{errors.lines}</p>}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">Quantity</th>
                  <th className="px-4 py-2.5 text-right">Unit price</th>
                  <th className="px-4 py-2.5 text-right">Line total</th>
                  <th className="px-2 py-2.5"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => {
                  const product = productById.get(Number(line.productId));
                  const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                  return (
                    <tr key={line.key} className="align-top">
                      <td className="px-4 py-3">
                        <select aria-label="Product" className={inputClass} value={line.productId} onChange={(e) => chooseProduct(line.key, e.target.value)}>
                          <option value="">Choose a product</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} · {p.name}
                            </option>
                          ))}
                        </select>
                        {errors[`product-${line.key}`] && <p className="mt-1 text-xs text-rose-600">{errors[`product-${line.key}`]}</p>}
                        {product && <p className="mt-1 text-xs text-slate-500">On hand {quantity(product.quantity)} {product.unit} · Reorder point {quantity(product.reorder_level)}</p>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input aria-label="Quantity" type="number" min={0} step="any" className={`${inputClass} w-28 text-right font-mono`} value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                        {errors[`qty-${line.key}`] && <p className="mt-1 text-xs text-rose-600">{errors[`qty-${line.key}`]}</p>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input aria-label="Unit price" type="number" min={0} step="0.01" className={`${inputClass} w-32 text-right font-mono`} value={line.unitPrice} onChange={(e) => update(line.key, { unitPrice: e.target.value })} />
                        {errors[`price-${line.key}`] && <p className="mt-1 text-xs text-rose-600">{errors[`price-${line.key}`]}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">{money(lineTotal)}</td>
                      <td className="px-2 py-3 text-right">
                        <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" aria-label="Remove item" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== line.key) : [newLine()]))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-slate-700">Order total</td>
                  <td className="px-4 py-3 text-right font-mono text-base font-semibold tabular-nums text-slate-900">{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-slate-500">Unit price defaults to the product's cost and can be changed for this order.</p>
        </section>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className={buttonSecondary} onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="button" className={buttonSecondary} disabled={saving !== null} onClick={() => save('draft')}>
            {saving === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" className={buttonPrimary} disabled={saving !== null} onClick={() => save('submit')}>
            {saving === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </form>
    </div>
  );
};
