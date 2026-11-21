import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import type { RateLimiter } from '../worker/services/auth/types';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, TestPasswordHasher } from './helpers/memoryAuth';

class MissingMigrationsLimiter implements RateLimiter {
  async allow(): Promise<boolean> {
    // Mirrors the D1 exception raised when 0002_auth_security.sql was not applied.
    throw new Error('no such table: auth_attempts: SQLITE_ERROR');
  }
}

function serviceWithMissingSchema() {
  let counter = 0;
  return new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MissingMigrationsLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `id-${++counter}` },
  });
}

describe('missing D1 migrations', () => {
  it('reports an actionable error without leaking SQL or credentials', async () => {
    const secret = 'do-not-leak-this-password';
    const { call } = createHarness(serviceWithMissingSchema());
    await call('GET', '/api/auth/csrf');

    const response = await call('POST', '/api/auth/register', {
      email: 'schema-error@example.com',
      password: secret,
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('schema_not_migrated');
    expect(body.message).toContain('D1 migrations');
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('auth_attempts');
    expect(JSON.stringify(body)).not.toContain('SQLITE_ERROR');
  });

  it('keeps unrelated internal errors as generic 500 responses', async () => {
    let counter = 0;
    const auth = new AuthService({
      repository: new MemoryAuthRepository(),
      hasher: new TestPasswordHasher(),
      limiter: {
        async allow() {
          throw new Error('an unrelated internal failure');
        },
      },
      clock: { now: () => 1_700_000_000 },
      ids: { newId: () => `id-${++counter}` },
    });
    const { call } = createHarness(auth);
    await call('GET', '/api/auth/csrf');
    const response = await call('POST', '/api/auth/register', {
      email: 'unrelated@example.com',
      password: 'a-long-test-password',
    });
    expect(response.status).toBe(500);
    expect((await response.json())).toMatchObject({ error: 'internal_error' });
  });
});
