// Indian digit grouping: 125000 -> ₹1,25,000.00
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const quantityFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function money(value: number | null | undefined): string {
  return inr.format(Number(value) || 0);
}

export function moneyWhole(value: number | null | undefined): string {
  return inrWhole.format(Number(value) || 0);
}

export function quantity(value: number | null | undefined): string {
  return quantityFormat.format(Number(value) || 0);
}

export function percent(value: number | null | undefined): string {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

// Dates arrive as ISO timestamps or YYYY-MM-DD. Date-only values are parsed in local time so they never shift a day.
export function dateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeOnly(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent: 'Sent',
  partially_received: 'Partially received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
