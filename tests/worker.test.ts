import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

function harness() {
  let counter = 0;
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `id-${++counter}` },
  });
  return createHarness(auth);
}

describe('worker API contract', () => {
  it('exposes a minimal health endpoint', async () => {
    const { call } = harness();
    const response = await call('GET', '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'veyro' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('truthfully reports future endpoints as unimplemented', async () => {
    const { call } = harness();
    await call('GET', '/api/auth/csrf');
    const response = await call('POST', '/api/epg', { query: 'demo' });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'not_implemented' });
  });

  it('never exposes a stream proxy endpoint, even when authenticated', async () => {
    const { call } = harness();
    await call('GET', '/api/auth/csrf');
    await call('POST', '/api/auth/register', { email: 'proxy@example.com', password: 'long-enough-password' });

    const response = await call('GET', '/api/proxy-stream');
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'not_implemented' });
  });
});
