import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-4 w-full' }) => (
  <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden="true" />
);

export const PageLoading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="space-y-4 py-6" role="status" aria-live="polite">
    <Skeleton className="h-6 w-64" />
    <Skeleton className="h-4 w-96 max-w-full" />
    <Skeleton className="h-40 w-full" />
    <span className="sr-only">{label}</span>
  </div>
);
