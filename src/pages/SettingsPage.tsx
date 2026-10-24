import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Lab } from '../types/index.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, buttonDanger, ErrorBanner } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Sparkles } from 'lucide-react';

const MODES = [
  { value: 'alert_only', label: 'Alerts only', text: 'Show low-stock alerts on the Reorder page. No purchase orders are created.' },
  { value: 'draft_po', label: 'Draft purchase orders', text: 'Create a draft order for each supplier when stock reaches the reorder point. A person reviews and submits it.' },
  { value: 'auto_send', label: 'Automatic', text: 'Submit, approve and send drafts under the auto-approve limit, if budget allows. Larger drafts wait for review.' },
];

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { labs, refreshLabs } = useLab();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [institution, setInstitution] = useState('');
  const [savedInstitution, setSavedInstitution] = useState('');
  const [labId, setLabId] = useState<number | ''>('');
  const [lab, setLab] = useState<Lab | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingInstitution, setSavingInstitution] = useState(false);
  const [savingLab, setSavingLab] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoDone, setDemoDone] = useState<string | null>(null);

  useEffect(() => {
    api.settings
      .get()
      .then((res) => {
        setInstitution(res.settings.institution_name ?? '');
        setSavedInstitution(res.settings.institution_name ?? '');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (labId === '' && labs.length) setLabId(labs[0].id);
  }, [labs, labId]);

  useEffect(() => {
    if (labId === '') return;
    api.labs
      .list()
      .then((res) => {
        const found = (res.labs as Lab[]).find((l) => l.id === labId) ?? null;
        setLab(found);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [labId]);

  if (user?.role !== 'admin') return <p className="text-sm text-slate-600">Only the administrator can change settings.</p>;
  if (loading) return <PageLoading label="Loading settings" />;

  const saveInstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (institution.trim().length < 2) {
      setError('Enter the institution name.');
      return;
    }
    setSavingInstitution(true);
    try {
      const res = await api.settings.update({ institution_name: institution.trim() });
      setSavedInstitution(res.settings.institution_name);
      success('Institution name saved. Documents will use it.');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSavingInstitution(false);
    }
  };

  const saveLab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lab || labId === '') return;
    setSavingLab(true);
    try {
      const updated = await api.labs.update(lab.id, {
        code: lab.code,
        automation_mode: lab.automation_mode,
        auto_approve_limit: Number(lab.auto_approve_limit),
        safety_days: Number(lab.safety_days),
      });
      setLab({ ...lab, ...updated.lab });
      success(`${lab.name} settings saved.`);
      refreshLabs();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSavingLab(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await api.admin.runAutomation();
      const sent = res.labs.reduce((n: number, l: { auto_sent: string[] }) => n + l.auto_sent.length, 0);
      const review = res.labs.reduce((n: number, l: { needs_review: string[] }) => n + l.needs_review.length, 0);
      const created = res.labs.reduce((n: number, l: { created_pos: number }) => n + l.created_pos, 0);
      success(`Automation ran for ${res.labs.length} labs: ${created} drafts created, ${sent} sent automatically, ${review} waiting for review.`);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const loadDemo = async () => {
    setLoadingDemo(true);
    try {
      await api.admin.loadDemo();
      setConfirmDemo(false);
      setDemoDone('Demo data loaded. Sign in again as admin@stocksense.dev (password Admin@123).');
      logout();
      navigate('/login');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Institution details, how each laboratory orders, and sample data.</p>
      </div>

      {error && <ErrorBanner message={error} />}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Institution</h2>
        <form onSubmit={saveInstitution} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Name on documents" htmlFor="set-inst" hint="Appears on purchase orders, receipts and reports.">
              <input id="set-inst" className={inputClass} value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </Field>
          </div>
          <button type="submit" className={buttonPrimary} disabled={savingInstitution || institution.trim() === savedInstitution}>
            {savingInstitution ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Laboratory ordering</h2>
          <select aria-label="Laboratory" className={`${inputClass} sm:w-64`} value={labId} onChange={(e) => setLabId(Number(e.target.value))}>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {lab && (
          <form onSubmit={saveLab} className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">Automation</legend>
              {MODES.map((m) => (
                <label key={m.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${lab.automation_mode === m.value ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="mode" className="mt-1" checked={lab.automation_mode === m.value} onChange={() => setLab({ ...lab, automation_mode: m.value as Lab['automation_mode'] })} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{m.label}</span>
                    <span className="block text-xs text-slate-500">{m.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Lab code" htmlFor="set-code" hint="Used in PO and GRN numbers.">
                <input id="set-code" className={`${inputClass} font-mono uppercase`} value={lab.code} maxLength={8} onChange={(e) => setLab({ ...lab, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Auto-approve limit (₹)" htmlFor="set-limit" hint="Used by automatic mode only.">
                <input id="set-limit" type="number" min={0} step="0.01" className={`${inputClass} font-mono`} value={lab.auto_approve_limit} onChange={(e) => setLab({ ...lab, auto_approve_limit: Number(e.target.value) })} />
              </Field>
              <Field label="Safety days" htmlFor="set-safety" hint="Extra days of stock kept on top of lead time, for the suggestions.">
                <input id="set-safety" type="number" min={0} max={60} step={1} className={`${inputClass} font-mono`} value={lab.safety_days} onChange={(e) => setLab({ ...lab, safety_days: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" className={buttonSecondary} onClick={runNow} disabled={running}>
                <Sparkles className="h-4 w-4 text-indigo-600" /> {running ? 'Running…' : 'Run automation now'}
              </button>
              <button type="submit" className={buttonPrimary} disabled={savingLab}>{savingLab ? 'Saving…' : 'Save laboratory settings'}</button>
            </div>
          </form>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-rose-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Demo data</h2>
        <p className="text-sm text-slate-600">
          Replaces every laboratory, product, order, receipt, budget and user with the sample dataset: three labs, about 40 products, 60 days of stock history, and purchase orders in every state. Use it to see every screen with data. All existing data is deleted.
        </p>
        {demoDone && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{demoDone}</p>}
        <div className="flex justify-end">
          <button type="button" className={buttonDanger} onClick={() => setConfirmDemo(true)} disabled={loadingDemo}>
            Load demo data
          </button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={confirmDemo}
        onClose={() => setConfirmDemo(false)}
        onConfirm={loadDemo}
        title="Replace all data with the demo dataset?"
        message="This deletes every existing laboratory, product, order, receipt, budget, user and audit record, then loads the sample data. You will be signed out. This cannot be undone."
        confirmLabel="Replace all data"
        isLoading={loadingDemo}
      />
    </div>
  );
};
