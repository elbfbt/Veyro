import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import {
  MAX_PASSWORD_HASH_ITERATIONS,
  WebCryptoPasswordHasher,
  passwordHashFormat,
} from '../worker/services/auth/password';
import { constantTimeEqual, hashToken, randomToken } from '../worker/services/auth/tokens';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter } from './helpers/memoryAuth';

function realHasherApi() {
  let counter = 0;
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new WebCryptoPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `real-hash-id-${++counter}` },
  });
  return createHarness(auth);
}

describe('Web Crypto password hashing', () => {
  const hasher = new WebCryptoPasswordHasher();

  it('hashes with exactly 100,000 PBKDF2-SHA-256 iterations and a random salt', async () => {
    expect(MAX_PASSWORD_HASH_ITERATIONS).toBe(100_000);
    expect(passwordHashFormat.iterations).toBe(100_000);

    const hash = await hasher.hash('correct horse battery');
    const [algorithm, iterationText, salt, digest] = hash.split('$');

    expect(algorithm).toBe('pbkdf2-sha256');
    expect(iterationText).toBe('100000');
    expect(salt).toMatch(/^[\w-]+$/);
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(16);
    expect(digest).toMatch(/^[\w-]+$/);
    expect(hash).not.toContain('correct horse battery');
  });

  it('verifies a valid 100,000-iteration hash and rejects a wrong password', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(await hasher.verify('correct horse battery', hash)).toBe(true);
    expect(await hasher.verify('wrong password', hash)).toBe(false);
  });

  it('produces different hashes for the same password', async () => {
    const first = await hasher.hash('same-password-123');
    const second = await hasher.hash('same-password-123');
    expect(first).not.toBe(second);
  });

  it('rejects malformed hashes', async () => {
    expect(await hasher.verify('anything', 'not-a-hash')).toBe(false);
    expect(await hasher.verify('anything', 'pbkdf2-sha256$1$abc$def')).toBe(false);
  });

  it('rejects unsupported iteration counts before reaching deriveBits', async () => {
    const unsupportedHashes = [
      `pbkdf2-sha256$210000$${randomToken(16)}$${randomToken(32)}`,
      `pbkdf2-sha256$100001$${randomToken(16)}$${randomToken(32)}`,
      `pbkdf2-sha256$99999$${randomToken(16)}$${randomToken(32)}`,
    ];
    const deriveSpy = vi.spyOn(crypto.subtle, 'deriveBits').mockRejectedValue(new Error('must not derive'));

    try {
      for (const hash of unsupportedHashes) {
        expect(await hasher.verify('anything', hash)).toBe(false);
      }
      expect(deriveSpy).not.toHaveBeenCalled();
    } finally {
      deriveSpy.mockRestore();
    }
  });
});

describe('authentication API with the real 100k hasher', () => {
  const credentials = { email: 'real-hash@example.com', password: 'long-enough-password' };

  it('registers and logs in successfully', async () => {
    const { call, jar } = realHasherApi();
    await call('GET', '/api/auth/csrf');

    const register = await call('POST', '/api/auth/register', credentials);
    expect(register.status).toBe(201);
    expect(jar.has('veyro_session')).toBe(true);

    const login = await call('POST', '/api/auth/login', credentials);
    expect(login.status).toBe(200);
    expect((await login.json()).user.email).toBe(credentials.email);
  });

  it('returns invalid_credentials for a wrong password', async () => {
    const { call } = realHasherApi();
    await call('GET', '/api/auth/csrf');

    const register = await call('POST', '/api/auth/register', credentials);
    expect(register.status).toBe(201);

    const login = await call('POST', '/api/auth/login', {
      ...credentials,
      password: 'not-the-right-password',
    });
    expect(login.status).toBe(400);
    expect(await login.json()).toMatchObject({ error: 'invalid_credentials' });
  });
});

describe('tokens', () => {
  it('generates unique random tokens and stable hashes', async () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThan(30);
    expect(token).not.toBe(randomToken());
    expect(await hashToken(token)).toBe(await hashToken(token));
    expect(await hashToken(token)).not.toBe(token);
  });

  it('compares tokens without leaking length differences', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
