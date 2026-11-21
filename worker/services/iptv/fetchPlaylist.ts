import { PlaylistLimitError } from './m3uParser';
import { UnsafeUrlError, assertSafePublicUrl, assertSafeResolvedHost } from './urlSafety';
import type { PlaylistFetchResult, PlaylistFetcher } from './types';

export class PlaylistFetchError extends Error {
  constructor(message = 'The provider playlist could not be retrieved.') {
    super(message);
    this.name = 'PlaylistFetchError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export interface PlaylistFetcherOptions {
  fetchImpl?: typeof fetch;
  verifyDns?: boolean;
}

/** Bounded, SSRF-checked fetch for playlist manifests only; never media. */
export function createPlaylistFetcher(options: PlaylistFetcherOptions = {}): PlaylistFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const verifyDns = options.verifyDns ?? true;

  return async (rawUrl, limits = {}): Promise<PlaylistFetchResult> => {
    const maxBytes = limits.maxBytes ?? 5 * 1024 * 1024;
    const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let currentUrl = assertSafePublicUrl(rawUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const parsed = assertSafePublicUrl(currentUrl);
        if (verifyDns) await assertSafeResolvedHost(parsed.hostname, fetchImpl);
        const response = await fetchImpl(parsed.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/vnd.apple.mpegurl, text/plain, */*;q=0.1' },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new PlaylistFetchError();
          currentUrl = assertSafePublicUrl(new URL(location, parsed.toString()).toString()).toString();
          continue;
        }

        if (!response.ok) throw new PlaylistFetchError();

        const declared = Number(response.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > maxBytes) {
          throw new PlaylistLimitError('The provider playlist is too large to import.');
        }
        if (!response.body) return { text: '', bytes: 0 };

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let text = '';
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new PlaylistLimitError('The provider playlist is too large to import.');
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return { text, bytes };
      }
      throw new PlaylistFetchError();
    } catch (error) {
      if (error instanceof PlaylistLimitError || error instanceof UnsafeUrlError) throw error;
      throw new PlaylistFetchError();
    } finally {
      clearTimeout(timer);
    }
  };
}

export const fetchPublicPlaylist: PlaylistFetcher = createPlaylistFetcher();
