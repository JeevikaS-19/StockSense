import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { api, errorMessage } from '../api/client.ts';
import { Package2, ArrowRight } from 'lucide-react';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, ErrorBanner } from '../components/common/Field.tsx';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const { success } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
    api.auth
      .status()
      .then((res) => setNeedsSetup(!res.has_admin))
      .catch(() => setNeedsSetup(false));
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.auth.login({ email, password });
      login(res.token, res.user);
      success(`Welcome back, ${res.user.name}.`);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Check your email and password.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 md:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Package2 className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">StockSense</h1>
            <p className="text-xs text-slate-500">Lab inventory and procurement</p>
          </div>
        </div>

        {needsSetup && (
          <div className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
            <p className="font-medium">No administrator yet</p>
            <p className="mt-1 text-indigo-900">The first account you create becomes the laboratory administrator.</p>
            <Link to="/signup" className="mt-2 inline-flex items-center gap-1 font-medium text-indigo-700 hover:text-indigo-900">
              Create the administrator account <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>
        <p className="mb-5 mt-1 text-sm text-slate-500">Use the email address your laboratory administrator registered.</p>

        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email address" htmlFor="login-email" required>
            <input id="login-email" type="email" required autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@university.edu" />
          </Field>
          <Field label="Password" htmlFor="login-password" required>
            <input id="login-password" type="password" required autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="submit" disabled={submitting} className={`${buttonPrimary} w-full py-2.5`}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
          Have a staff invitation?{' '}
          <Link to="/signup" className="font-medium text-indigo-600 hover:text-indigo-800">
            Create your account
          </Link>
        </p>
      </div>
    </div>
  );
};
