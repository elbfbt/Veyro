import { describe, expect, it, vi } from 'vitest';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { createPlaylistFetcher, PlaylistFetchError } from '../worker/services/iptv/fetchPlaylist';
import { PlaylistLimitError } from '../worker/services/iptv/m3uParser';
import { assertSafePublicUrl, assertSafeResolvedHost, UnsafeUrlError } from '../worker/services/iptv/urlSafety';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('provider URL safety', () => {
  it('allows ordinary public URLs', () => {
    expect(assertSafePublicUrl('https://example.com/playlist.m3u8').hostname).toBe('example.com');
  });

  it.each([
    'http://127.0.0.1/playlist',
    'http://localhost/playlist',
    'http://192.168.1.1/playlist',
    'http://10.0.0.5/playlist',
    'http://169.254.169.254/latest',
    'http://[::1]/playlist',
    'file:///etc/passwd',
    'https://user:pass@example.com/playlist',
  ])('blocks unsafe URL %s', (value) => {
    expect(() => assertSafePublicUrl(value)).toThrow(UnsafeUrlError);
  });

  it('checks DNS answers and fails closed when resolution is unavailable', async () => {
    const privateAnswer = vi.fn(async () =>
      new Response(JSON.stringify({ Answer: [{ type: 1, data: '10.0.0.7' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(assertSafeResolvedHost('provider.example.com', privateAnswer)).rejects.toThrow(UnsafeUrlError);

    const publicAnswer = vi.fn(async () =>
      new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(assertSafeResolvedHost('provider.example.com', publicAnswer)).resolves.toBeUndefined();

    const mixedAnswer = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).includes('type=AAAA')
            ? { Answer: [{ type: 28, data: 'fd00::1' }] }
            : { Answer: [{ type: 1, data: '93.184.216.34' }] },
        ),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    await expect(assertSafeResolvedHost('provider.example.com', mixedAnswer)).rejects.toThrow(UnsafeUrlError);

    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(assertSafeResolvedHost('provider.example.com', failing)).rejects.toThrow(UnsafeUrlError);
  });
});

describe('provider credential encryption', () => {
  it('produces ciphertext without persisting or exposing the plaintext', async () => {
    const cipher = new ProviderCredentialCipher(SECRET);
    const encrypted = await cipher.encrypt(JSON.stringify({ username: 'viewer', password: 'super-secret-value' }));
    expect(encrypted.keyId).toBe('aes-gcm-v1');
    expect(encrypted.ciphertext).not.toContain('super-secret-value');
    expect(encrypted.ciphertext).not.toContain('viewer');
    expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('refuses to encrypt without a configured worker secret', async () => {
    await expect(new ProviderCredentialCipher(undefined).encrypt('secret')).rejects.toThrow();
  });


  it('decrypts server-side and rejects wrong keys without leaking plaintext', async () => {
    const cipher = new ProviderCredentialCipher(SECRET);
    const plaintext = JSON.stringify({ username: 'viewer', password: 'round-trip-secret' });
    const encrypted = await cipher.encrypt(plaintext);
    expect(await cipher.decrypt(encrypted.ciphertext, encrypted.keyId)).toBe(plaintext);
    await expect(cipher.decrypt(encrypted.ciphertext, 'aes-gcm-v2')).rejects.toThrow(
      'Provider credentials could not be secured.',
    );
    const wrongSecret = new ProviderCredentialCipher('b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90');
    await expect(wrongSecret.decrypt(encrypted.ciphertext, encrypted.keyId)).rejects.toThrow(
      'Provider credentials could not be secured.',
    );
  });
});

describe('bounded playlist fetching', () => {
  it('revalidates redirects and never follows them to private hosts', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    ) as unknown as typeof fetch;
    const fetcher = createPlaylistFetcher({ fetchImpl, verifyDns: false });
    await expect(fetcher('https://example.com/list.m3u8')).rejects.toThrow(UnsafeUrlError);
  });

  it('enforces body limits and wraps transport failures generically', async () => {
    const bigFetch = vi.fn(async () => new Response('x'.repeat(64), { status: 200 })) as unknown as typeof fetch;
    const fetcher = createPlaylistFetcher({ fetchImpl: bigFetch, verifyDns: false });
    await expect(fetcher('https://example.com/list.m3u8', { maxBytes: 10 })).rejects.toThrow(PlaylistLimitError);

    const failing = vi.fn(async () => {
      throw new Error('network details that must not leak');
    }) as unknown as typeof fetch;
    const failingFetcher = createPlaylistFetcher({ fetchImpl: failing, verifyDns: false });
    await expect(failingFetcher('https://example.com/list.m3u8')).rejects.toThrow(PlaylistFetchError);
  });
});
