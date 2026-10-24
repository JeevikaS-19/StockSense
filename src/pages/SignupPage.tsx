import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { ArrowRight, ShieldCheck, Key } from 'lucide-react';
import { Wordmark } from '../components/common/Wordmark.tsx';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, ErrorBanner } from '../components/common/Field.tsx';

// Signup has three paths: the first administrator (no invite), staff with an invite link (?invite=…,
// where the email is prefilled and locked), or a pasted invitation token.
export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { success } = useToast();

  const inviteFromLink = searchParams.get('invite') || searchParams.get('token') || '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteToken, setInviteToken] = useState(inviteFromLink);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [inviteLabs, setInviteLabs] = useState<{ id: number; name: string; code: string }[]>([]);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth
      .status()
      .then((res) => setNeedsSetup(!res.has_admin))
      .catch(() => setNeedsSetup(false));
  }, []);

  // Check the invitation whenever a token is present, prefill and lock the email on success.
  useEffect(() => {
    const token = inviteToken.trim();
    if (!token || needsSetup) {
      setInviteLabs([]);
      setInviteStatus(null);
      return;
    }
    api.auth
      .invitation(token)
      .then((res) => {
        setEmail(res.email);
        setInviteLabs(res.labs);
        setInviteStatus(null);
      })
      .catch((err) => {
        setInviteLabs([]);
        setInviteStatus(errorMessage(err, 'This invitation link is not valid.'));
      });
  }, [inviteToken, needsSetup]);

  const emailLocked = inviteLabs.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string> = { name: name.trim(), email: email.trim(), password };
      if (!needsSetup && inviteToken.trim()) payload.invite_token = inviteToken.trim();
      const res = await api.auth.signup(payload);
      login(res.token, res.user);
      success(res.user.role === 'admin' ? 'Administrator account created.' : 'Your staff account is ready.');
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, 'Registration failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const staffNeedsToken = needsSetup === false;

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center p-4">
      <div className="auth-blob auth-blob-amber" aria-hidden="true" />
      <div className="auth-blob auth-blob-burnt" aria-hidden="true" />
      <div className="auth-blob auth-blob-peach" aria-hidden="true" />
      <div className="w-full max-w-md rounded-3xl border border-orange-100 bg-white/90 p-6 shadow-xl backdrop-blur md:p-8">
        <div className="mb-8">
          <Wordmark />
        </div>

        {needsSetup === true && (
          <div className="mb-5 flex gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
            <p>You are creating the laboratory administrator account. No invitation is needed.</p>
          </div>
        )}
        {staffNeedsToken && !inviteLabs.length && (
          <div className="mb-5 flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <Key className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p>Staff accounts need the invitation link or token from your laboratory administrator.</p>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-900">{needsSetup === true ? 'Create administrator account' : 'Create your account'}</h2>

        <div className="my-4 space-y-4">
          <ErrorBanner message={error ?? inviteStatus} />
          {inviteLabs.length > 0 && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              You are joining: {inviteLabs.map((lab) => `${lab.name} (${lab.code})`).join(', ')}.
            </p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name" htmlFor="signup-name" required>
            <input id="signup-name" type="text" required minLength={2} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Alex Morgan" />
          </Field>
          <Field label="Email address" htmlFor="signup-email" required hint={emailLocked ? 'Fixed by your invitation.' : undefined}>
            <input id="signup-email" type="email" required readOnly={emailLocked} className={`${inputClass} ${emailLocked ? 'bg-slate-100' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@university.edu" />
          </Field>
          <Field label="Password" htmlFor="signup-password" required hint="At least 6 characters.">
            <input id="signup-password" type="password" required minLength={6} autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {staffNeedsToken && (
            <Field label="Invitation token" htmlFor="signup-token" required={!inviteFromLink} hint="Paste it here if you did not open the invitation link.">
              <input id="signup-token" type="text" required={!inviteToken} className={`${inputClass} font-mono`} value={inviteToken} onChange={(e) => setInviteToken(e.target.value.trim())} />
            </Field>
          )}
          <button type="submit" disabled={submitting || needsSetup === null} className={`${buttonPrimary} w-full py-2.5`}>
            {submitting ? 'Creating account…' : needsSetup === true ? 'Create administrator account' : 'Create account'}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-800">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
