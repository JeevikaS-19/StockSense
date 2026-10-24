// An error that maps directly to the API error shape: { error: { code, message, ...details } }.
export class HttpError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function fail(status: number, code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new HttpError(status, code, message, details);
}

// Money and quantities are stored as NUMERIC(12,2); keep arithmetic at 2 decimal places.
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
