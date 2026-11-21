import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/state/AuthContext';

interface Call {
  method: string;
  url: string;
  csrf: string | null;
}

const user = {
  id: 'user-1',
  email: 'lifecycle@example.com',
  displayName: 'Lifecycle Tester',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function recordCall(calls: Call[], input: RequestInfo | URL, init?: RequestInit): Call {
  const call = {
    method: (init?.method ?? 'GET').toUpperCase(),
    url: String(input),
    csrf: new Headers(init?.headers).get('x-csrf-token'),
  };
  calls.push(call);
  return call;
}

function captureAuth() {
  const captured: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
  function Capture() {
    captured.auth = useAuth();
    return null;
  }
  renderToStaticMarkup(createElement(AuthProvider, null, createElement(Capture)));
  const auth = captured.auth;
  if (!auth) throw new Error('Auth context was not captured');
  return auth;
}

describe('auth CSRF lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses an existing CSRF cookie without requesting a new one', async () => {
    const fakeDocument = { cookie: 'veyro_csrf=existing-csrf' };
    vi.stubGlobal('document', fakeDocument);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url !== '/api/auth/forgot-password') throw new Error(`Unexpected request: ${call.url}`);
        return jsonResponse({ accepted: true });
      }),
    );

    await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
    });

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual(['POST /api/auth/forgot-password']);
    expect(calls[0]?.csrf).toBe('existing-csrf');
  });

  it('initializes a missing CSRF cookie before sending a mutating request', async () => {
    const fakeDocument = { cookie: '' };
    vi.stubGlobal('document', fakeDocument);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url === '/api/auth/csrf' && call.method === 'GET') {
          fakeDocument.cookie = 'veyro_csrf=created-csrf';
          return jsonResponse({ csrfToken: 'created-csrf' });
        }
        if (call.url === '/api/auth/forgot-password' && call.method === 'POST') {
          return jsonResponse({ accepted: true });
        }
        throw new Error(`Unexpected request: ${call.method} ${call.url}`);
      }),
    );

    await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
    });

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/auth/csrf',
      'POST /api/auth/forgot-password',
    ]);
    expect(calls[1]?.csrf).toBe('created-csrf');
  });

  it('registers successfully from a fresh state with no CSRF cookie', async () => {
    const fakeDocument = { cookie: '' };
    vi.stubGlobal('document', fakeDocument);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url === '/api/auth/csrf' && call.method === 'GET') {
          fakeDocument.cookie = 'veyro_csrf=register-csrf';
          return jsonResponse({ csrfToken: 'register-csrf' });
        }
        if (call.url === '/api/auth/register' && call.method === 'POST') {
          expect(call.csrf).toBe('register-csrf');
          fakeDocument.cookie = 'veyro_csrf=register-csrf; veyro_session=session-1';
          return jsonResponse({ user, csrfToken: 'register-csrf', expiresAt: 1_700_100_000 });
        }
        if (call.url === '/api/auth/me' && call.method === 'GET') {
          return jsonResponse({ user, csrfToken: 'register-csrf', sessionId: 'session-1', expiresAt: 1_700_100_000 });
        }
        throw new Error(`Unexpected request: ${call.method} ${call.url}`);
      }),
    );

    const auth = captureAuth();
    await auth.register({ email: user.email, password: 'long-enough-password' });

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/auth/csrf',
      'POST /api/auth/register',
      'GET /api/auth/me',
    ]);
    expect(calls[1]?.csrf).toBe('register-csrf');
  });

  it('logs in successfully from a fresh state with no CSRF cookie', async () => {
    const fakeDocument = { cookie: '' };
    vi.stubGlobal('document', fakeDocument);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url === '/api/auth/csrf' && call.method === 'GET') {
          fakeDocument.cookie = 'veyro_csrf=login-csrf';
          return jsonResponse({ csrfToken: 'login-csrf' });
        }
        if (call.url === '/api/auth/login' && call.method === 'POST') {
          expect(call.csrf).toBe('login-csrf');
          fakeDocument.cookie = 'veyro_csrf=login-csrf; veyro_session=session-1';
          return jsonResponse({ user, csrfToken: 'login-csrf', expiresAt: 1_700_100_000 });
        }
        if (call.url === '/api/auth/me' && call.method === 'GET') {
          return jsonResponse({ user, csrfToken: 'login-csrf', sessionId: 'session-1', expiresAt: 1_700_100_000 });
        }
        throw new Error(`Unexpected request: ${call.method} ${call.url}`);
      }),
    );

    const auth = captureAuth();
    await auth.login({ email: user.email, password: 'long-enough-password' });

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/auth/csrf',
      'POST /api/auth/login',
      'GET /api/auth/me',
    ]);
    expect(calls[1]?.csrf).toBe('login-csrf');
  });

  it('login -> logout -> login again sends a fresh CSRF token without a page reload', async () => {
    const fakeDocument = { cookie: 'veyro_csrf=initial-csrf' };
    vi.stubGlobal('document', fakeDocument);

    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url === '/api/auth/login' && call.method === 'POST') {
          expect(call.csrf).toBe(cookieValue(fakeDocument.cookie, 'veyro_csrf'));
          fakeDocument.cookie = 'veyro_csrf=login-csrf; veyro_session=session-1';
          return jsonResponse({ user, csrfToken: 'login-csrf', expiresAt: 1_700_100_000 });
        }
        if (call.url === '/api/auth/me' && call.method === 'GET') {
          return jsonResponse({ user, csrfToken: 'login-csrf', sessionId: 'session-1', expiresAt: 1_700_100_000 });
        }
        if (call.url === '/api/auth/logout' && call.method === 'POST') {
          expect(call.csrf).toBe('login-csrf');
          fakeDocument.cookie = '';
          return jsonResponse({ ok: true });
        }
        if (call.url === '/api/auth/csrf' && call.method === 'GET') {
          fakeDocument.cookie = 'veyro_csrf=fresh-csrf';
          return jsonResponse({ csrfToken: 'fresh-csrf' });
        }
        throw new Error(`Unexpected request: ${call.method} ${call.url}`);
      }),
    );

    const auth = captureAuth();
    const credentials = { email: user.email, password: 'long-enough-password' };
    await auth.login(credentials);
    await auth.logout();
    await auth.login(credentials);

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/auth/login',
      'GET /api/auth/me',
      'POST /api/auth/logout',
      'GET /api/auth/csrf',
      'POST /api/auth/login',
      'GET /api/auth/me',
    ]);
    expect(calls[0]?.csrf).toBe('initial-csrf');
    expect(calls[2]?.csrf).toBe('login-csrf');
    expect(calls[4]?.csrf).toBe('fresh-csrf');
  });

  it('does not send a mutating request when CSRF initialization cannot establish a cookie', async () => {
    const fakeDocument = { cookie: '' };
    vi.stubGlobal('document', fakeDocument);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = recordCall(calls, input, init);
        if (call.url === '/api/auth/csrf' && call.method === 'GET') {
          return jsonResponse({ csrfToken: 'not-stored-in-a-cookie' });
        }
        throw new Error(`Unexpected mutating request: ${call.method} ${call.url}`);
      }),
    );

    const error = await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'csrf_initialization_failed' });
    expect((error as Error).message).toContain('CSRF');
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual(['GET /api/auth/csrf']);
  });
});
