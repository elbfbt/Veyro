import { PlaylistLimitError } from './m3uParser';
import { UnsafeUrlError, assertSafePublicUrl, assertSafeResolvedHost } from './urlSafety';
import type { PlaylistFetchResult, PlaylistFetcher } from './types';

export class PlaylistFetchError extends Error {
  constructor(message = 'The provider request could not be completed.') {
    super(message);
    this.name = 'PlaylistFetchError';
  }
}

export class UpstreamHttpError extends Error {
  constructor(public readonly status: number) {
    super('The upstream request failed.');
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super('The upstream request timed out.');
    this.name = 'UpstreamTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export interface BoundedFetchOptions {
  fetchImpl?: typeof fetch;
  verifyDns?: boolean;
  accept?: string;
}

export interface BoundedFetchLimits {
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Bounded, SSRF-checked text fetch for metadata manifests and JSON catalogues.
 * It never follows media streams and never includes the requested URL in errors.
 */
export function createBoundedTextFetcher(options: BoundedFetchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const verifyDns = options.verifyDns ?? true;
  const accept = options.accept ?? 'text/plain, */*;q=0.1';

  return async (rawUrl: string, limits: BoundedFetchLimits = {}): Promise<PlaylistFetchResult> => {
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
          headers: { accept },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new PlaylistFetchError();
          currentUrl = assertSafePublicUrl(new URL(location, parsed.toString()).toString()).toString();
          continue;
        }

        if (!response.ok) throw new UpstreamHttpError(response.status);

        const declared = Number(response.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > maxBytes) {
          throw new PlaylistLimitError('The provider response is too large to import.');
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
            throw new PlaylistLimitError('The provider response is too large to import.');
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return { text, bytes };
      }
      throw new PlaylistFetchError();
    } catch (error) {
      if (
        error instanceof PlaylistLimitError ||
        error instanceof UnsafeUrlError ||
        error instanceof UpstreamHttpError ||
        error instanceof UpstreamTimeoutError
      ) {
        throw error;
      }
      if (controller.signal.aborted) throw new UpstreamTimeoutError();
      throw new PlaylistFetchError();
    } finally {
      clearTimeout(timer);
    }
  };
}

export const createPlaylistFetcher = (options: BoundedFetchOptions = {}): PlaylistFetcher =>
  createBoundedTextFetcher({ ...options, accept: 'application/vnd.apple.mpegurl, text/plain, */*;q=0.1' });

export const fetchPublicPlaylist: PlaylistFetcher = createPlaylistFetcher();
