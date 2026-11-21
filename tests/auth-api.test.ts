import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

function service() {
  let counter = 0;
  return new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `api-id-${++counter}` },
  });
}

const credentials = { email: 'api@example.com', password: 'long-enough-password' };

describe('authentication API', () => {
  it('issues a CSRF token and rejects state-changing requests without it', async () => {
    const { call, jar } = createHarness(service());
    const csrfResponse = await call('GET', '/api/auth/csrf');
    expect(csrfResponse.status).toBe(200);
    expect(jar.has('veyro_csrf')).toBe(true);

    const rejected = await call(
      'POST',
      '/api/auth/register',
      credentials,
      { csrf: false, cookie: false },
    );
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: 'csrf_failed' });
  });

  it('registers, persists the session cookie and returns a safe user object', async () => {
    const { call, jar } = createHarness(service());
    await call('GET', '/api/auth/csrf');

    const response = await call('POST', '/api/auth/register', {
      ...credentials,
      displayName: 'API Tester',
      deviceName: 'Test Browser',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user).toMatchObject({ email: 'api@example.com', displayName: 'API Tester' });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(jar.has('veyro_session')).toBe(true);

    const sessionCookie = (await response.headers.getSetCookie?.() ?? []).find((cookie) =>
      cookie.startsWith('veyro_session='),
    );
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');

    const me = await call('GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe('api@example.com');
  });

  it('requires authentication and protects session management', async () => {
    const { call } = createHarness(service());
    await call('GET', '/api/auth/csrf');

    expect((await call('GET', '/api/auth/me', undefined, { cookie: false })).status).toBe(401);
    expect((await call('GET', '/api/auth/sessions', undefined, { cookie: false })).status).toBe(401);
    expect((await call('POST', '/api/auth/logout', {}, { session: false })).status).toBe(401);
  });

  it('logs out, clears cookies and invalidates the session', async () => {
    const { call, jar } = createHarness(service());
    await call('GET', '/api/auth/csrf');
    await call('POST', '/api/auth/register', credentials);
    await call('POST', '/api/auth/login', credentials);

    const sessions = await call('GET', '/api/auth/sessions');
    expect((await sessions.json()).sessions.length).toBe(2);

    const logout = await call('POST', '/api/auth/logout', {});
    expect(logout.status).toBe(200);
    expect(jar.has('veyro_session')).toBe(false);
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
  });

  it('returns the same generic password-reset response for any email', async () => {
    const { call } = createHarness(service());
    await call('GET', '/api/auth/csrf');

    const existing = await call('POST', '/api/auth/forgot-password', { email: 'api@example.com' });
    const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(existing.status).toBe(202);
    expect(await existing.json()).toEqual(await unknown.json());

    const confirm = await call('POST', '/api/auth/password-reset/confirm', { token: 'fake' });
    expect(confirm.status).toBe(501);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const auth = service();
    const { handleApi } = createHarness(auth);
    const response = await handleApi(
      new Request('https://veyro.test/api/auth/register', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'x-csrf-token': 'anything' },
        body: JSON.stringify(credentials),
      }),
      new URL('https://veyro.test/api/auth/register'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'origin_rejected' });
  });
});
