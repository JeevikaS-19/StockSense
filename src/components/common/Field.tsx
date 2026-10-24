import React from 'react';

// Label, control and inline error in one place, so every form looks and reads the same.
export const Field: React.FC<{ label: string; htmlFor?: string; hint?: string; error?: string | null; required?: boolean; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
      {label}
      {required && <span className="text-rose-600"> *</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
    {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
  </div>
);

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-500';

// Same look as inputClass but sized to its content, for filter bars.
export const compactInputClass = inputClass.replace('w-full ', '');

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const buttonDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const ErrorBanner: React.FC<{ message: string | null | undefined; onRetry?: () => void }> = ({ message, onRetry }) => {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium text-rose-900 underline">
          Try again
        </button>
      )}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
    <p className="font-medium text-slate-800">{title}</p>
    {text && <p className="mt-1 text-sm text-slate-500">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
