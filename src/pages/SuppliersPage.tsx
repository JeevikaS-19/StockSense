import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Supplier } from '../types/index.ts';
import { Modal } from '../components/common/Modal.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Truck, Plus, Mail, Phone, MapPin, User, Edit2, Package } from 'lucide-react';

const EMPTY = { name: '', contact_person: '', email: '', phone: '', address: '' };

export const SuppliersPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === 'admin';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api.suppliers
      .list()
      .then((res) => setSuppliers(res.suppliers))
      .catch((err) => setError(errorMessage(err, 'Could not load suppliers.')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError({});
    setOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ name: s.name, contact_person: s.contact_person ?? '', email: s.email ?? '', phone: s.phone ?? '', address: s.address ?? '' });
    setFormError({});
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (form.name.trim().length < 2) errors.name = 'Enter the supplier name.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address.';
    setFormError(errors);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      if (editing) {
        await api.suppliers.update(editing.id, form);
        success(`${form.name} updated.`);
      } else {
        await api.suppliers.create(form);
        success(`${form.name} added.`);
      }
      setOpen(false);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Suppliers</h1>
          <p className="text-sm text-slate-500">A shared vendor list used by every laboratory.{!isAdmin && ' Only the administrator can change it.'}</p>
        </div>
        {isAdmin && (
          <button type="button" onClick={openNew} className={buttonPrimary}>
            <Plus className="h-4 w-4" /> Add supplier
          </button>
        )}
      </div>

      <ErrorBanner message={error} onRetry={load} />
      {loading ? (
        <PageLoading label="Loading suppliers" />
      ) : suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet" text={isAdmin ? 'Add the vendors your labs order from. They are linked to products and purchase orders.' : 'Your administrator has not added any suppliers yet.'} action={isAdmin ? <button type="button" onClick={openNew} className={buttonPrimary}><Plus className="h-4 w-4" /> Add supplier</button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <div key={s.id} className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5">
              <div>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold leading-tight text-slate-900">{s.name}</h2>
                      {s.contact_person && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <User className="h-3 w-3" /> {s.contact_person}
                        </p>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button type="button" onClick={() => openEdit(s)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${s.name}`}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="my-3 space-y-1.5 text-sm text-slate-600">
                  {s.email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <a href={`mailto:${s.email}`} className="truncate hover:text-indigo-600">{s.email}</a>
                    </p>
                  )}
                  {s.phone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="font-mono text-xs">{s.phone}</span>
                    </p>
                  )}
                  {s.address && (
                    <p className="flex items-start gap-2 text-xs text-slate-500">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="line-clamp-2">{s.address}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Package className="h-3.5 w-3.5 text-slate-400" /> Products
                </span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">{s.product_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between pt-2 text-sm text-slate-500">
                <span>Open orders</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">{s.open_po_count ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? 'Edit supplier' : 'Add supplier'} description="Contact details appear on purchase orders sent to this supplier.">
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="Company name" htmlFor="s-name" required error={formError.name}>
            <input id="s-name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Contact person" htmlFor="s-contact">
            <input id="s-contact" className={inputClass} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Order email" htmlFor="s-email" error={formError.email} hint="Purchase orders are emailed here when sent.">
              <input id="s-email" type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="s-phone">
              <input id="s-phone" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          <Field label="Address" htmlFor="s-address">
            <textarea id="s-address" rows={2} className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save supplier' : 'Add supplier'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
