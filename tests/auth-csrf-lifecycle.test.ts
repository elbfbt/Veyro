import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('auth CSRF lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login -> logout -> login again sends a fresh CSRF token without a page reload', async () => {
    const fakeDocument = { cookie: 'veyro_csrf=initial-csrf' };
    vi.stubGlobal('document', fakeDocument);

    const calls: Call[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      const csrf = headers.get('x-csrf-token');
      calls.push({ method, url, csrf });

      if (url === '/api/auth/login' && method === 'POST') {
        expect(csrf).toBe(cookieValue(fakeDocument.cookie, 'veyro_csrf'));
        fakeDocument.cookie = 'veyro_csrf=login-csrf; veyro_session=session-1';
        return jsonResponse({ user, csrfToken: 'login-csrf', expiresAt: 1_700_100_000 });
      }
      if (url === '/api/auth/me' && method === 'GET') {
        return jsonResponse({ user, csrfToken: 'login-csrf', sessionId: 'session-1', expiresAt: 1_700_100_000 });
      }
      if (url === '/api/auth/logout' && method === 'POST') {
        expect(csrf).toBe('login-csrf');
        fakeDocument.cookie = '';
        return jsonResponse({ ok: true });
      }
      if (url === '/api/auth/csrf' && method === 'GET') {
        fakeDocument.cookie = 'veyro_csrf=fresh-csrf';
        return jsonResponse({ csrfToken: 'fresh-csrf' });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const captured: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
    function Capture() {
      captured.auth = useAuth();
      return null;
    }
    renderToStaticMarkup(createElement(AuthProvider, null, createElement(Capture)));
    const auth = captured.auth;
    if (!auth) throw new Error('Auth context was not captured');

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
});
