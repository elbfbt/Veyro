const CSRF_COOKIE = 'veyro_csrf';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiErrorBody {
  error: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Raw GET: must not call apiRequest(), otherwise CSRF initialization would recurse. */
async function initializeCsrfToken(): Promise<string> {
  try {
    const response = await fetch('/api/auth/csrf', { credentials: 'include' });
    await response.text();
    if (!response.ok) throw new Error(`CSRF initialization returned ${response.status}`);
  } catch {
    throw new ApiError(0, 'csrf_initialization_failed', 'Could not initialize CSRF protection. Please retry.');
  }

  const token = readCookie(CSRF_COOKIE);
  if (!token) {
    throw new ApiError(0, 'csrf_initialization_failed', 'CSRF cookie was not established. Please retry.');
  }
  return token;
}

/** Same-origin API client. Session cookies are httpOnly and handled by the browser. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && method !== 'GET' && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  let csrfToken = readCookie(CSRF_COOKIE);
  if (MUTATING_METHODS.has(method)) {
    if (!csrfToken) csrfToken = await initializeCsrfToken();
    headers.set('x-csrf-token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, method, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the Veyro API. Is the Worker running?');
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = (body ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, error.error ?? 'request_failed', error.message ?? 'Request failed.');
  }
  return body as T;
}
