export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, any>;

  constructor(code: string, message: string, status: number, details: Record<string, any> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const TOKEN_KEY = 'stocksense_jwt_token';
export const SESSION_EXPIRED_EVENT = 'stocksense:session-expired';

// localStorage can throw in private windows or when storage is blocked, so every access is guarded.
export const tokenStorage = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* the session still works for this page load */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

const SESSION_CODES = ['UNAUTHORIZED', 'INVALID_TOKEN'];

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check that it is running and try again.', 0);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  if (!response.ok) {
    const data = isJson ? await response.json().catch(() => ({})) : {};
    const error = data.error || {};
    const code = error.code || 'UNKNOWN_ERROR';
    if (response.status === 401 && SESSION_CODES.includes(code) && token) {
      tokenStorage.clear();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const { code: _code, message: _message, ...details } = error;
    throw new ApiError(code, error.message || `Request failed with status ${response.status}`, response.status, details);
  }

  if (!isJson) return (await response.text()) as unknown as T;
  return (await response.json()) as T;
}

function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') q.append(key, String(value));
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export const api = {
  auth: {
    status: () => apiRequest('/api/auth/status'),
    signup: (body: unknown) => apiRequest('/api/auth/signup', json('POST', body)),
    login: (body: unknown) => apiRequest('/api/auth/login', json('POST', body)),
    me: () => apiRequest('/api/auth/me'),
    invitation: (token: string) => apiRequest(`/api/auth/invitations/${encodeURIComponent(token)}`),
    invite: (body: unknown) => apiRequest('/api/auth/invite', json('POST', body)),
  },
  labs: {
    list: () => apiRequest('/api/labs'),
    create: (body: unknown) => apiRequest('/api/labs', json('POST', body)),
    update: (id: number, body: unknown) => apiRequest(`/api/labs/${id}`, json('PUT', body)),
    members: (id: number) => apiRequest(`/api/labs/${id}/members`),
    setMembers: (id: number, userIds: number[]) => apiRequest(`/api/labs/${id}/members`, json('POST', { user_ids: userIds })),
    removeMember: (id: number, userId: number) => apiRequest(`/api/labs/${id}/members/${userId}`, { method: 'DELETE' }),
  },
  products: {
    list: (params: Record<string, unknown>) => apiRequest(`/api/products${query(params)}`),
    categories: (labId: number) => apiRequest(`/api/products/categories${query({ lab_id: labId })}`),
    create: (body: unknown) => apiRequest('/api/products', json('POST', body)),
    update: (id: number, body: unknown) => apiRequest(`/api/products/${id}`, json('PUT', body)),
    archive: (id: number, labId: number) => apiRequest(`/api/products/${id}${query({ lab_id: labId })}`, { method: 'DELETE' }),
  },
  reorder: {
    overview: (labId: number) => apiRequest(`/api/reorder${query({ lab_id: labId })}`),
    scan: (labId: number) => apiRequest('/api/reorder/scan', json('POST', { lab_id: labId })),
    update: (productId: number, body: unknown) => apiRequest(`/api/reorder/products/${productId}`, json('PUT', body)),
  },
  stock: {
    move: (body: unknown) => apiRequest('/api/stock/movement', json('POST', body)),
  },
  transactions: {
    list: (params: Record<string, unknown>) => apiRequest(`/api/transactions${query(params)}`),
  },
  suppliers: {
    list: () => apiRequest('/api/suppliers'),
    create: (body: unknown) => apiRequest('/api/suppliers', json('POST', body)),
    update: (id: number, body: unknown) => apiRequest(`/api/suppliers/${id}`, json('PUT', body)),
  },
  purchaseOrders: {
    list: (params: Record<string, unknown>) => apiRequest(`/api/purchase-orders${query(params)}`),
    get: (id: number) => apiRequest(`/api/purchase-orders/${id}`),
    create: (body: unknown) => apiRequest('/api/purchase-orders', json('POST', body)),
    update: (id: number, body: unknown) => apiRequest(`/api/purchase-orders/${id}`, json('PUT', body)),
    action: (id: number, action: string, body: unknown = {}) => apiRequest(`/api/purchase-orders/${id}/${action}`, json('POST', body)),
    receive: (id: number, body: unknown) => apiRequest(`/api/purchase-orders/${id}/receive`, json('POST', body)),
    uploadInvoice: (id: number, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiRequest(`/api/purchase-orders/${id}/invoice`, { method: 'POST', body: form });
    },
  },
  receipts: {
    get: (id: number) => apiRequest(`/api/receipts/${id}`),
  },
  invoices: {
    update: (id: number, body: unknown) => apiRequest(`/api/invoices/${id}`, json('PUT', body)),
    accept: (id: number) => apiRequest(`/api/invoices/${id}/accept`, json('POST', {})),
    dispute: (id: number, reason: string) => apiRequest(`/api/invoices/${id}/dispute`, json('POST', { reason })),
  },
  budgets: {
    summary: (labId: number) => apiRequest(`/api/budgets/summary${query({ lab_id: labId })}`),
    update: (body: unknown) => apiRequest('/api/budgets', json('PUT', body)),
    ledger: (params: Record<string, unknown>) => apiRequest(`/api/budgets/ledger${query(params)}`),
  },
  dashboard: {
    stats: (labId: string | number) => apiRequest(`/api/dashboard/stats${query({ lab_id: labId })}`),
  },
  notifications: {
    list: () => apiRequest('/api/notifications'),
    read: (id: number) => apiRequest(`/api/notifications/${id}/read`, { method: 'POST' }),
    readAll: () => apiRequest('/api/notifications/read-all', { method: 'POST' }),
  },
  requests: {
    list: (params: Record<string, unknown>) => apiRequest(`/api/requests${query(params)}`),
    create: (body: unknown) => apiRequest('/api/requests', json('POST', body)),
    resolve: (id: number) => apiRequest(`/api/requests/${id}/resolve`, json('POST', {})),
  },
  audit: {
    list: (params: Record<string, unknown>) => apiRequest(`/api/audit${query(params)}`),
  },
  reports: {
    generate: (body: unknown) => apiRequest('/api/reports', json('POST', body)),
    csvUrl: (params: Record<string, unknown>) => `/api/reports/csv${query(params)}`,
  },
  settings: {
    get: () => apiRequest('/api/settings'),
    update: (body: unknown) => apiRequest('/api/settings', json('PUT', body)),
  },
  ai: {
    thresholdSuggestions: (labId: number) => apiRequest(`/api/ai/threshold-suggestions${query({ lab_id: labId })}`),
    applyThresholds: (body: unknown) => apiRequest('/api/ai/threshold-suggestions/apply', json('POST', body)),
    fitPreview: (poId: number) => apiRequest('/api/ai/fit-to-budget/preview', json('POST', { po_id: poId })),
    fitConfirm: (poId: number, keepItemIds: number[]) =>
      apiRequest('/api/ai/fit-to-budget/confirm', json('POST', { po_id: poId, keep_item_ids: keepItemIds })),
    reportSummary: (body: unknown) => apiRequest('/api/ai/report-summary', json('POST', body)),
    emailDraft: (poId: number) => apiRequest('/api/ai/supplier-email/draft', json('POST', { po_id: poId })),
    emailSend: (body: unknown) => apiRequest('/api/ai/supplier-email/send', json('POST', body)),
  },
  admin: {
    loadDemo: () => apiRequest('/api/admin/demo-data', json('POST', {})),
    runAutomation: () => apiRequest('/api/admin/automation/run', json('POST', {})),
  },
  publicPo: {
    get: (token: string) => apiRequest(`/api/public/po/${encodeURIComponent(token)}`),
    confirm: (token: string) => apiRequest(`/api/public/po/${encodeURIComponent(token)}/confirm`, { method: 'POST' }),
    uploadInvoice: (token: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiRequest(`/api/public/po/${encodeURIComponent(token)}/invoice`, { method: 'POST', body: form });
    },
  },
  health: () => apiRequest('/api/health'),
};

// Downloads a file from an authenticated endpoint. A plain link cannot send the Bearer token, so the file
// is fetched with the header and handed to the browser as a blob.
export async function downloadFile(endpoint: string, fallbackName: string): Promise<void> {
  const token = tokenStorage.get();
  const res = await fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error?.code ?? 'DOWNLOAD_FAILED', data.error?.message ?? 'The file could not be downloaded.', res.status);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Turns any thrown value into a human message for toasts and inline errors.
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
