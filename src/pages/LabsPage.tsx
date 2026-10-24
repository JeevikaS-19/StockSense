import React, { useEffect, useState } from 'react';
import { useLab } from '../context/LabContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Lab, User } from '../types/index.ts';
import { Modal } from '../components/common/Modal.tsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, EmptyState, ErrorBanner } from '../components/common/Field.tsx';
import { Building2, Plus, Users, Edit2, Mail, Copy, Check, MapPin, Boxes, ChevronDown, ChevronRight, UserMinus } from 'lucide-react';

interface LabForm {
  name: string;
  department: string;
  location: string;
  code: string;
}

const EMPTY_LAB: LabForm = { name: '', department: '', location: '', code: '' };

export const LabsPage: React.FC = () => {
  const { refreshLabs } = useLab();
  const { success, error: toastError } = useToast();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labModal, setLabModal] = useState<{ open: boolean; editing: Lab | null }>({ open: false, editing: null });
  const [labForm, setLabForm] = useState<LabForm>(EMPTY_LAB);
  const [labErrors, setLabErrors] = useState<Record<string, string>>({});
  const [savingLab, setSavingLab] = useState(false);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [members, setMembers] = useState<Record<number, User[]>>({});
  const [assignLab, setAssignLab] = useState<Lab | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [assignedIds, setAssignedIds] = useState<number[]>([]);
  const [savingAssign, setSavingAssign] = useState(false);
  const [removing, setRemoving] = useState<{ lab: Lab; user: User } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLabs, setInviteLabs] = useState<number[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteEmailed, setInviteEmailed] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api.labs
      .list()
      .then((res) => setLabs(res.labs))
      .catch((err) => setError(errorMessage(err, 'Could not load laboratories.')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadMembers = async (lab: Lab) => {
    const res = await api.labs.members(lab.id);
    setMembers((prev) => ({ ...prev, [lab.id]: res.members }));
    setAllUsers(res.available_users);
  };

  const toggleMembers = async (lab: Lab) => {
    const open = !expanded[lab.id];
    setExpanded((prev) => ({ ...prev, [lab.id]: open }));
    if (open && !members[lab.id]) {
      try {
        await loadMembers(lab);
      } catch (err) {
        toastError(errorMessage(err));
      }
    }
  };

  const openLabModal = (lab: Lab | null) => {
    setLabForm(lab ? { name: lab.name, department: lab.department, location: lab.location, code: lab.code } : EMPTY_LAB);
    setLabErrors({});
    setLabModal({ open: true, editing: lab });
  };

  const saveLab = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (labForm.name.trim().length < 2) errors.name = 'Enter the laboratory name.';
    if (labForm.department.trim().length < 2) errors.department = 'Enter the department.';
    if (labForm.location.trim().length < 2) errors.location = 'Enter the location.';
    if (labForm.code && !/^[A-Za-z0-9]{2,8}$/.test(labForm.code)) errors.code = 'Use 2 to 8 letters or numbers.';
    setLabErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingLab(true);
    try {
      const body = { name: labForm.name.trim(), department: labForm.department.trim(), location: labForm.location.trim(), ...(labForm.code ? { code: labForm.code.trim().toUpperCase() } : {}) };
      if (labModal.editing) {
        await api.labs.update(labModal.editing.id, body);
        success(`${body.name} updated.`);
      } else {
        await api.labs.create(body);
        success(`${body.name} created.`);
      }
      setLabModal({ open: false, editing: null });
      load();
      refreshLabs();
    } catch (err) {
      setLabErrors({ form: errorMessage(err) });
    } finally {
      setSavingLab(false);
    }
  };

  const openAssign = async (lab: Lab) => {
    setAssignLab(lab);
    try {
      const res = await api.labs.members(lab.id);
      setAllUsers(res.available_users);
      setAssignedIds(res.members.map((m: User) => m.id));
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const saveAssign = async () => {
    if (!assignLab) return;
    setSavingAssign(true);
    try {
      await api.labs.setMembers(assignLab.id, assignedIds);
      success(`Staff for ${assignLab.name} updated.`);
      setAssignLab(null);
      await loadMembers(assignLab);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setSavingAssign(false);
    }
  };

  const removeMember = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api.labs.removeMember(removing.lab.id, removing.user.id);
      success(`${removing.user.name} removed from ${removing.lab.name}.`);
      setRemoving(null);
      await loadMembers(removing.lab);
      load();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setRemoveBusy(false);
    }
  };

  const openInvite = () => {
    setInviteEmail('');
    setInviteLabs(labs.length ? [labs[0].id] : []);
    setInviteUrl(null);
    setInviteError(null);
    setCopied(false);
    setInviteOpen(true);
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || inviteLabs.length === 0) {
      setInviteError('Enter an email address and choose at least one laboratory.');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      const res = await api.auth.invite({ email: inviteEmail.trim(), lab_ids: inviteLabs });
      setInviteUrl(`${window.location.origin}${res.invite_url}`);
      setInviteEmailed(Boolean(res.emailed));
      success('Invitation created. It is valid for 7 days.');
    } catch (err) {
      setInviteError(errorMessage(err));
    } finally {
      setInviting(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError('Copy did not work here. Select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Labs and team</h1>
          <p className="text-sm text-slate-500">Create laboratories, assign staff, and invite new people. Lab settings are on the Settings page.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonSecondary} onClick={openInvite}>
            <Mail className="h-4 w-4 text-indigo-600" /> Invite staff
          </button>
          <button type="button" className={buttonPrimary} onClick={() => openLabModal(null)}>
            <Plus className="h-4 w-4" /> Create laboratory
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />
      {!loading && labs.length === 0 && <EmptyState title="No laboratories yet" text="Create the first laboratory, then invite staff to it." action={<button type="button" className={buttonPrimary} onClick={() => openLabModal(null)}>Create laboratory</button>} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {labs.map((lab) => (
          <div key={lab.id} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Building2 className="h-4 w-4" /></div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{lab.name}</h2>
                  <p className="text-xs text-slate-500">{lab.department} · <span className="font-mono">{lab.code}</span></p>
                </div>
              </div>
              <button type="button" onClick={() => openLabModal(lab)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${lab.name}`}>
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {lab.location}</p>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <span className="flex items-center gap-1.5 text-slate-600"><Boxes className="h-3.5 w-3.5 text-slate-400" /> Active products</span>
              <span className="font-mono tabular-nums font-semibold">{lab.product_count ?? 0}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <button type="button" onClick={() => toggleMembers(lab)} className="flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-800" aria-expanded={!!expanded[lab.id]}>
                {expanded[lab.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Users className="h-3.5 w-3.5" /> {lab.member_count ?? 0} member{lab.member_count === 1 ? '' : 's'}
              </button>
              <button type="button" onClick={() => openAssign(lab)} className="text-sm font-medium text-slate-700 hover:text-slate-900">Assign staff</button>
            </div>
            {expanded[lab.id] && (
              <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
                {(members[lab.id] ?? []).length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No members yet.</li>}
                {(members[lab.id] ?? []).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{m.name}</span>
                      <span className="block truncate text-xs text-slate-500">{m.email} · {m.role}</span>
                    </span>
                    {m.role !== 'admin' && (
                      <button type="button" onClick={() => setRemoving({ lab, user: m })} className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900">
                        <UserMinus className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={labModal.open} onClose={() => setLabModal({ open: false, editing: null })} title={labModal.editing ? 'Edit laboratory' : 'Create laboratory'} description="A short code (for example EL) is used on purchase order and receipt numbers.">
        <form onSubmit={saveLab} className="space-y-4" noValidate>
          <ErrorBanner message={labErrors.form} />
          <Field label="Name" htmlFor="l-name" required error={labErrors.name}>
            <input id="l-name" className={inputClass} value={labForm.name} onChange={(e) => setLabForm({ ...labForm, name: e.target.value })} />
          </Field>
          <Field label="Department" htmlFor="l-dept" required error={labErrors.department}>
            <input id="l-dept" className={inputClass} value={labForm.department} onChange={(e) => setLabForm({ ...labForm, department: e.target.value })} />
          </Field>
          <Field label="Location" htmlFor="l-loc" required error={labErrors.location} hint="Building and room.">
            <input id="l-loc" className={inputClass} value={labForm.location} onChange={(e) => setLabForm({ ...labForm, location: e.target.value })} />
          </Field>
          <Field label="Lab code" htmlFor="l-code" error={labErrors.code} hint="Leave blank to generate one from the name. Changing it affects new document numbers only.">
            <input id="l-code" className={`${inputClass} font-mono uppercase`} value={labForm.code} onChange={(e) => setLabForm({ ...labForm, code: e.target.value })} placeholder="EL" maxLength={8} />
          </Field>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setLabModal({ open: false, editing: null })}>Cancel</button>
            <button type="submit" className={buttonPrimary} disabled={savingLab}>{savingLab ? 'Saving…' : labModal.editing ? 'Save laboratory' : 'Create laboratory'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!assignLab} onClose={() => setAssignLab(null)} title={`Staff for ${assignLab?.name ?? ''}`} description="Choose who can see and record stock in this laboratory.">
        <div className="space-y-4">
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {allUsers.map((u) => {
              const checked = assignedIds.includes(u.id);
              return (
                <label key={u.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={checked} disabled={u.role === 'admin'} onChange={(e) => setAssignedIds(e.target.checked ? [...assignedIds, u.id] : assignedIds.filter((id) => id !== u.id))} className="rounded border-slate-300 text-indigo-600" />
                    <span>
                      <span className="block font-medium text-slate-900">{u.name}</span>
                      <span className="block text-xs text-slate-500">{u.email}</span>
                    </span>
                  </span>
                  <span className="text-xs uppercase text-slate-500">{u.role}{u.role === 'admin' ? ' · all labs' : ''}</span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setAssignLab(null)}>Cancel</button>
            <button type="button" className={buttonPrimary} onClick={saveAssign} disabled={savingAssign}>{savingAssign ? 'Saving…' : 'Save assignments'}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={removeMember}
        title="Remove from laboratory"
        message={`Remove ${removing?.user.name ?? ''} from ${removing?.lab.name ?? ''}? They keep their account but lose access to this lab.`}
        confirmLabel="Remove"
        isLoading={removeBusy}
      />

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite staff" description="The invitation is for one email address, valid for 7 days, and opens with that address fixed.">
        <form onSubmit={invite} className="space-y-4" noValidate>
          <ErrorBanner message={inviteError} />
          <Field label="Email address" htmlFor="inv-email" required>
            <input id="inv-email" type="email" className={inputClass} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="assistant@university.edu" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Laboratories <span className="text-rose-600">*</span></legend>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {labs.map((lab) => (
                <label key={lab.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={inviteLabs.includes(lab.id)} onChange={(e) => setInviteLabs(e.target.checked ? [...inviteLabs, lab.id] : inviteLabs.filter((id) => id !== lab.id))} className="rounded border-slate-300 text-indigo-600" />
                  <span><strong>{lab.name}</strong> ({lab.department})</span>
                </label>
              ))}
            </div>
          </fieldset>
          {inviteUrl && (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-900">Invitation ready</p>
              <p className="text-xs text-emerald-800">{inviteEmailed ? 'We also emailed the link.' : 'Share this link with them. It is shown once, so copy it now.'}</p>
              <div className="flex gap-2">
                <input readOnly aria-label="Invitation link" value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
                <button type="button" onClick={copyInvite} className={buttonSecondary} aria-label="Copy invitation link">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={buttonSecondary} onClick={() => setInviteOpen(false)}>Done</button>
            <button type="submit" className={buttonPrimary} disabled={inviting}>{inviting ? 'Creating…' : 'Create invitation'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
