import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Product, Supplier, Pagination } from '../types/index.ts';
import { StatusChip } from '../components/common/StatusChip.tsx';
import { Modal } from '../components/common/Modal.tsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { DataTable, Column } from '../components/common/DataTable.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, compactInputClass, buttonPrimary, buttonSecondary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { RestockRequestModal } from '../components/layout/RestockRequestModal.tsx';
import { useDebounce } from '../hooks/useDebounce.ts';
import { ArrowUpDown, Plus, Search, Edit2, Trash2, Hand } from 'lucide-react';
import { money, quantity } from '../lib/format.ts';

type FormState = {
  sku: string;
  name: string;
  description: string;
  category: string;
  newCategory: string;
  supplierId: string;
  unit: string;
  unitPrice: string;
  reorderLevel: string;
  reorderQty: string;
  leadTimeDays: string;
};

const EMPTY_FORM: FormState = {
  sku: '',
  name: '',
  description: '',
  category: '',
  newCategory: '',
  supplierId: '',
  unit: 'units',
  unitPrice: '0',
  reorderLevel: '5',
  reorderQty: '',
  leadTimeDays: '7',
};

const PAGE_SIZES = [10, 25, 50];

export const ProductsPage: React.FC = () => {
  const { user } = useAuth();
  const { activeLabId, activeLab } = useLab();
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === 'admin';
  const labId = typeof activeLabId === 'number' ? activeLabId : null;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, total_pages: 1 });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [requestFor, setRequestFor] = useState<Product | null>(null);

  useEffect(() => {
    api.suppliers
      .list()
      .then((res) => setSuppliers(res.suppliers))
      .catch(() => setSuppliers([]));
  }, []);

  // A new search or filter goes back to page 1.
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [debouncedSearch, category, lowOnly, sortBy, order, labId]);

  const load = useCallback(async () => {
    if (labId === null) return;
    setLoading(true);
    setError(null);
    try {
      const [res, cats] = await Promise.all([
        api.products.list({ lab_id: labId, search: debouncedSearch, category, low_stock: lowOnly ? 'true' : '', sort_by: sortBy, order, page: pagination.page, limit: pagination.limit }),
        api.products.categories(labId),
      ]);
      setProducts(res.products);
      setPagination(res.pagination);
      setCategories(cats.categories);
    } catch (err) {
      setError(errorMessage(err, 'Could not load products.'));
    } finally {
      setLoading(false);
    }
  }, [labId, debouncedSearch, category, lowOnly, sortBy, order, pagination.page, pagination.limit]);

  useEffect(() => {
    load();
  }, [load]);

  const sortHeader = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (sortBy === key) setOrder(order === 'asc' ? 'desc' : 'asc');
        else {
          setSortBy(key);
          setOrder('asc');
        }
      }}
      className="inline-flex items-center gap-1 hover:text-slate-900"
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortBy === key ? 'text-indigo-600' : 'text-slate-400'}`} />
    </button>
  );

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: categories[0] ?? '' });
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description ?? '',
      category: product.category,
      newCategory: '',
      supplierId: product.supplier_id ? String(product.supplier_id) : '',
      unit: product.unit,
      unitPrice: String(product.unit_price),
      reorderLevel: String(product.reorder_level),
      reorderQty: product.reorder_qty ? String(product.reorder_qty) : '',
      leadTimeDays: String(product.lead_time_days),
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!editing && !form.sku.trim()) errors.sku = 'Enter a SKU.';
    if (form.name.trim().length < 2) errors.name = 'Enter a product name (at least 2 characters).';
    const finalCategory = form.category === '__new__' ? form.newCategory.trim() : form.category.trim();
    if (!finalCategory) errors.category = 'Choose or type a category.';
    if (!form.unit.trim()) errors.unit = 'Enter a unit, for example pcs or kg.';
    if (Number(form.unitPrice) < 0 || form.unitPrice === '') errors.unitPrice = 'Unit cost cannot be negative.';
    if (Number(form.reorderLevel) < 0 || form.reorderLevel === '') errors.reorderLevel = 'Reorder point cannot be negative.';
    if (form.reorderQty !== '' && (!Number.isInteger(Number(form.reorderQty)) || Number(form.reorderQty) <= 0)) errors.reorderQty = 'Reorder quantity must be a whole number above zero.';
    if (form.leadTimeDays === '' || Number(form.leadTimeDays) < 0 || !Number.isInteger(Number(form.leadTimeDays))) errors.leadTimeDays = 'Lead time must be whole days, zero or more.';
    return errors;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (labId === null) return;
    const errors = validate();
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category === '__new__' ? form.newCategory.trim() : form.category.trim(),
      supplier_id: form.supplierId ? Number(form.supplierId) : null,
      unit: form.unit.trim(),
      unit_price: Number(form.unitPrice),
      reorder_level: Number(form.reorderLevel),
      reorder_qty: form.reorderQty ? Number(form.reorderQty) : null,
      lead_time_days: Number(form.leadTimeDays),
    };
    setSaving(true);
    try {
      if (editing) {
        await api.products.update(editing.id, { lab_id: labId, ...body });
        success(`${body.name} updated.`);
      } else {
        await api.products.create({ lab_id: labId, sku: form.sku.trim(), ...body });
        success(`${body.name} added to ${activeLab?.name ?? 'the lab'}.`);
      }
      setFormOpen(false);
      load();
    } catch (err) {
      const message = errorMessage(err);
      toastError(message);
      setFormErrors((prev) => ({ ...prev, form: message }));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiving || labId === null) return;
    setArchiveBusy(true);
    try {
      await api.products.archive(archiving.id, labId);
      success(`${archiving.name} archived. Its history is kept.`);
      setArchiving(null);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (labId === null) {
    return (
      <EmptyState
        title={activeLabId === 'all' ? 'Choose a laboratory' : 'No laboratory assigned'}
        text={activeLabId === 'all' ? 'Products belong to one laboratory. Pick one from the switcher at the top.' : 'Ask your administrator to add you to a laboratory.'}
      />
    );
  }

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', render: (p) => <span className="font-mono text-xs font-medium text-slate-800">{p.sku}</span>, className: 'whitespace-nowrap' },
    {
      key: 'name',
      header: sortHeader('name', 'Product'),
      render: (p) => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate font-medium text-slate-900">{p.name}</p>
          <p className="truncate text-xs text-slate-500">
            {p.category} · {money(p.unit_price)} · {p.supplier_name ?? 'No supplier set'}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (p) => <StatusChip status={p.status} /> },
    {
      key: 'quantity',
      header: sortHeader('quantity', 'On hand'),
      align: 'right',
      render: (p) => (
        <span className="font-mono tabular-nums font-semibold text-slate-900">
          {quantity(p.quantity)} <span className="text-xs font-normal text-slate-400">{p.unit}</span>
        </span>
      ),
    },
    { key: 'on_order', header: 'On order', align: 'right', render: (p) => <span className="font-mono tabular-nums text-slate-600">{p.on_order > 0 ? quantity(p.on_order) : '—'}</span> },
    { key: 'reorder', header: sortHeader('reorder_level', 'Reorder point'), align: 'right', render: (p) => <span className="font-mono tabular-nums">{quantity(p.reorder_level)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          {!isAdmin && (p.status === 'low' || p.status === 'out') && (
            <button type="button" onClick={() => setRequestFor(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600" title="Request restock" aria-label={`Request restock for ${p.name}`}>
              <Hand className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => openEdit(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600" title="Edit product" aria-label={`Edit ${p.name}`}>
            <Edit2 className="h-4 w-4" />
          </button>
          {isAdmin && (
            <button type="button" onClick={() => setArchiving(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Archive product" aria-label={`Archive ${p.name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const fromRow = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const toRow = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Products</h1>
          <p className="text-sm text-slate-500">
            {activeLab?.name} · {pagination.total} active item{pagination.total === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" onClick={openAdd} className={buttonPrimary}>
          <Plus className="h-4 w-4" /> Add product
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input type="search" aria-label="Search products" placeholder="Search by SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={compactInputClass}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setLowOnly((v) => !v)}
            aria-pressed={lowOnly}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${lowOnly ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Low or out of stock
          </button>
          <select aria-label="Rows per page" value={pagination.limit} onChange={(e) => setPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 }))} className={compactInputClass}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        columns={columns}
        rows={products}
        rowKey={(p) => p.id}
        loading={loading && products.length === 0}
        emptyTitle={debouncedSearch || category || lowOnly ? 'No products match these filters' : 'No products yet'}
        emptyText={debouncedSearch || category || lowOnly ? 'Clear the filters to see everything in this lab.' : 'Add the first product, or set up reorder rules once stock is recorded.'}
        emptyAction={!debouncedSearch && !category && !lowOnly ? <button type="button" onClick={openAdd} className={buttonPrimary}><Plus className="h-4 w-4" /> Add product</button> : undefined}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing <span className="font-mono tabular-nums">{fromRow}–{toRow}</span> of <span className="font-mono tabular-nums">{pagination.total}</span>
            </span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))} className={buttonSecondary}>
                Previous
              </button>
              <span className="font-mono tabular-nums text-slate-700">
                {pagination.page} / {pagination.total_pages}
              </span>
              <button type="button" disabled={pagination.page >= pagination.total_pages} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))} className={buttonSecondary}>
                Next
              </button>
            </div>
          </div>
        }
      />

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit product' : 'Add product'}
        description={editing ? 'Stock on hand changes only through stock in and out, so it is not editable here.' : 'Quantity starts at zero. Record the first stock as a stock in.'}
        maxWidth="lg"
      >
        <form onSubmit={save} className="space-y-5" noValidate>
          {formErrors.form && <ErrorBanner message={formErrors.form} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SKU" htmlFor="p-sku" required={!editing} error={formErrors.sku} hint="Unique within this lab. Stored in capitals.">
              <input id="p-sku" disabled={!!editing} className={`${inputClass} font-mono uppercase`} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="EL-RES-010" />
            </Field>
            <Field label="Product name" htmlFor="p-name" required error={formErrors.name}>
              <input id="p-name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Resistor kit 1/4 W" />
            </Field>
          </div>
          <Field label="Description" htmlFor="p-desc">
            <input id="p-desc" className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="p-cat" required error={formErrors.category}>
              <select id="p-cat" className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">New category…</option>
              </select>
              {form.category === '__new__' && (
                <input aria-label="New category name" className={`${inputClass} mt-2`} value={form.newCategory} onChange={(e) => setForm({ ...form, newCategory: e.target.value })} placeholder="Type a category" />
              )}
            </Field>
            <Field label="Preferred supplier" htmlFor="p-sup" hint="Needed for automatic draft orders.">
              <select id="p-sup" className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">None yet</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Unit" htmlFor="p-unit" error={formErrors.unit}>
              <input id="p-unit" className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs" />
            </Field>
            <Field label="Unit cost (₹)" htmlFor="p-price" error={formErrors.unitPrice}>
              <input id="p-price" type="number" min={0} step="0.01" className={`${inputClass} font-mono`} value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
            </Field>
            <Field label="Lead time (days)" htmlFor="p-lead" error={formErrors.leadTimeDays} hint="Days from order to delivery.">
              <input id="p-lead" type="number" min={0} step={1} className={`${inputClass} font-mono`} value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Reorder point" htmlFor="p-rop" error={formErrors.reorderLevel} hint="Order when stock falls to this level or below.">
              <input id="p-rop" type="number" min={0} step="any" className={`${inputClass} font-mono`} value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
            </Field>
            <Field label="Reorder quantity" htmlFor="p-roq" error={formErrors.reorderQty} hint="Blank means order enough to get back to twice the reorder point.">
              <input id="p-roq" type="number" min={1} step={1} className={`${inputClass} font-mono`} value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setFormOpen(false)} className={buttonSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={buttonPrimary}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title="Archive product"
        message={`Archive ${archiving?.name ?? ''} (${archiving?.sku ?? ''})? It leaves the active list, but its movements and purchase history are kept.`}
        confirmLabel="Archive"
        isLoading={archiveBusy}
      />

      {requestFor && labId !== null && <RestockRequestModal labId={labId} productId={requestFor.id} onClose={() => setRequestFor(null)} />}
    </div>
  );
};
