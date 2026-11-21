import { describe, expect, it } from 'vitest';
import { WebCryptoPasswordHasher } from '../worker/services/auth/password';
import { constantTimeEqual, hashToken, randomToken } from '../worker/services/auth/tokens';

describe('Web Crypto password hashing', () => {
  const hasher = new WebCryptoPasswordHasher();

  it('stores a salted PBKDF2 string, never the plain password', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^pbkdf2-sha256\$210000\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain('correct horse battery');
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
