// Indian digit grouping, e.g. 125000 -> "₹1,25,000.00".
const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(value: number): string {
  return inrFormatter.format(value);
}
