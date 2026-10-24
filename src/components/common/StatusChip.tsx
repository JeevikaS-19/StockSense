import React from 'react';
import { PO_STATUS_LABEL } from '../../lib/format.ts';

const base = 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap';

const STOCK: Record<'ok' | 'low' | 'out', { label: string; tone: string }> = {
  ok: { label: 'In stock', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  low: { label: 'Low stock', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  out: { label: 'Out of stock', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

// Neutral for drafts and closed, blue while in progress, teal once received, red for rejected or cancelled.
const PO: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  pending_approval: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  partially_received: 'bg-blue-50 text-blue-700 border-blue-200',
  received: 'bg-teal-50 text-teal-700 border-teal-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const StatusChip: React.FC<{ status: 'ok' | 'low' | 'out'; className?: string }> = ({ status, className = '' }) => {
  const config = STOCK[status] ?? STOCK.ok;
  return <span className={`${base} ${config.tone} ${className}`}>{config.label}</span>;
};

export const PoStatusChip: React.FC<{ status: string; className?: string }> = ({ status, className = '' }) => (
  <span className={`${base} ${PO[status] ?? PO.draft} ${className}`}>{PO_STATUS_LABEL[status] ?? status}</span>
);

export const Chip: React.FC<{ tone?: 'neutral' | 'amber' | 'rose' | 'emerald' | 'blue'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return <span className={`${base} ${tones[tone]}`}>{children}</span>;
};
