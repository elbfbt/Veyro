import { describe, expect, it } from 'vitest';
import { AuthService, SESSION_TTL_SECONDS } from '../worker/services/auth/service';
import { AuthError } from '../worker/services/auth/types';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

function setup(now = 1_700_000_000) {
  const repository = new MemoryAuthRepository();
  const limiter = new MemoryRateLimiter();
  let counter = 0;
  const auth = new AuthService({
    repository,
    hasher: new TestPasswordHasher(),
    limiter,
    clock: { now: () => now },
    ids: { newId: () => `id-${++counter}` },
  });
  return { auth, repository, limiter, setNow: (value: number) => (now = value) };
}

const registerInput = {
  email: 'Viewer@Example.com ',
  password: 'a-secure-password',
  displayName: 'Alex',
  deviceName: 'Living Room TV',
};

describe('AuthService registration', () => {
  it('normalizes email, hashes the password and never stores the plain token', async () => {
    const { auth, repository } = setup();
    const result = await auth.register(registerInput);

    expect(result.user.email).toBe('viewer@example.com');
    expect(result.user).not.toHaveProperty('passwordHash');
    const stored = [...repository.users.values()][0];
    expect(stored?.passwordHash).toMatch(/^test-hash:[0-9a-f]+$/);
    expect(stored?.passwordHash).not.toContain('a-secure-password');

    const session = [...repository.sessions.values()][0];
    expect(session?.tokenHash).not.toBe(result.token);
    expect(session?.tokenHash).toMatch(/^[\w-]+$/);
  });

  it('registers a friendly device and rejects duplicate emails', async () => {
    const { auth, repository } = setup();
    await auth.register(registerInput);
    expect((await repository.listDevices('id-1'))[0]?.name).toBe('Living Room TV');

    await expect(auth.register(registerInput)).rejects.toMatchObject({
      code: 'email_taken',
    });
  });

  it('validates weak credentials before touching storage', async () => {
    const { auth, repository } = setup();
    await expect(auth.register({ email: 'bad', password: 'short' })).rejects.toBeInstanceOf(AuthError);
    expect(repository.users.size).toBe(0);
  });
});

describe('AuthService login and sessions', () => {
  it('logs in with the right password and rejects wrong credentials generically', async () => {
    const { auth } = setup();
    await auth.register(registerInput);

    const result = await auth.login({
      email: 'viewer@example.com',
      password: 'a-secure-password',
      clientKey: 'test-client',
    });
    expect(result.user.email).toBe('viewer@example.com');

    const wrong = await auth.login({
      email: 'viewer@example.com',
      password: 'not-the-password',
      clientKey: 'other-client',
    }).catch((error: unknown) => error as AuthError);
    const unknown = await auth.login({
      email: 'nobody@example.com',
      password: 'not-the-password',
      clientKey: 'other-client',
    }).catch((error: unknown) => error as AuthError);

    expect(wrong).toBeInstanceOf(AuthError);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((wrong as AuthError).message).toBe((unknown as AuthError).message);
  });

  it('validates tokens, expires them and scopes sessions to their owner', async () => {
    const { auth, repository, setNow } = setup();
    const first = await auth.register(registerInput);
    const second = await auth.register({ ...registerInput, email: 'second@example.com' });

    const context = await auth.authenticateToken(first.token);
    expect(context?.user.id).toBe(first.user.id);
    expect(context?.session.id).toBe(first.session.id);
    expect(await auth.authenticateToken('not-a-token')).toBeNull();

    expect((await auth.listSessions(first.user.id)).length).toBe(1);
    expect(await auth.revokeSession(second.user.id, first.session.id)).toBe(false);
    expect((await auth.listSessions(first.user.id)).length).toBe(1);

    setNow(1_700_000_000 + SESSION_TTL_SECONDS + 1);
    expect(await auth.authenticateToken(first.token)).toBeNull();
    expect(repository.sessions.size).toBe(2);
  });

  it('logs out only the current session', async () => {
    const { auth } = setup();
    const result = await auth.register(registerInput);
    const other = await auth.login({ email: result.user.email, password: 'a-secure-password', clientKey: 'tv' });

    await auth.logout(result.user.id, result.session.id);
    expect(await auth.authenticateToken(result.token)).toBeNull();
    expect(await auth.authenticateToken(other.token)).not.toBeNull();
  });

  it('blocks excessive attempts without logging credentials', async () => {
    const { auth } = setup();
    for (let index = 0; index < 10; index += 1) {
      await auth.login({ email: 'viewer@example.com', password: 'wrong-password', clientKey: 'abuse' })
        .catch(() => undefined);
    }
    const blocked = await auth.login({
      email: 'viewer@example.com',
      password: 'correct-password',
      clientKey: 'abuse',
    }).catch((error: unknown) => error as AuthError);
    expect(blocked).toMatchObject({ code: 'rate_limited' });
  });
});
