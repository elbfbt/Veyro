import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { ProviderService } from '../worker/services/iptv/providerService';
import {
  getImportProgress,
  importCancel,
  importChunk,
  importComplete,
  importInit,
} from '../src/lib/api';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';
import { MemoryProviderRepository } from './helpers/memoryProvider';

/**
 * Regression: the chunked-import helpers in src/lib/api.ts used to pass paths
 * that already contained "/api" to apiRequest(), which prepends "/api" itself.
 * The resulting "/api/api/providers/import-init" missed the route table, fell
 * through the worker's pre-auth 501 gate and every chunked import failed
 * immediately with "This API endpoint is planned for a later implementation
 * phase" - without creating a job or any rows.
 *
 * These tests run the real client functions through the real api.ts route
 * table, so a URL mismatch between the two can never pass again.
 */

const ORIGIN = 'https://veyro.test';
const CIPHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

type Harness = ReturnType<typeof createHarness>;

function makeEntry(index: number) {
  return {
    externalId: `ext-${index}`,
    name: `Channel ${index}`,
    streamUrl: `https://stream.example.com/${index}.m3u8`,
    tvgId: null,
    tvgName: null,
    tvgLogo: null,
    groupTitle: null,
    country: null,
    language: null,
    channelNumber: null,
    kind: 'channel' as const,
  };
}

function setup() {
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `auth-${Math.random()}` },
  });
  let counter = 0;
  const providers = new ProviderService({
    repository: new MemoryProviderRepository(),
    cipher: new ProviderCredentialCipher(CIPHER_KEY),
    ids: { newId: () => `provider-${++counter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist: async () => ({ text: '', bytes: 0 }),
  });
  return { auth, providers, harness: createHarness(auth, ORIGIN, providers) };
}

/**
 * Minimal browser transport: relative URLs are resolved against the origin and
 * the request is handed to the real worker handler. Cookies flow like a browser
 * (session cookie httpOnly, CSRF cookie readable through document.cookie, which
 * is all src/lib/api.ts touches).
 */
const cookieJar = new Map<string, string>();

function setScriptVisibleCookies() {
  const visible = [...cookieJar]
    .filter(([name]) => name === 'veyro_csrf')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  (globalThis as unknown as { document: { cookie: string } }).document = { cookie: visible };
}

function installBrowserFetch(harness: Harness) {
  const requests: { method: string; path: string }[] = [];
  cookieJar.clear();
  for (const [name, value] of harness.jar) cookieJar.set(name, value);
  setScriptVisibleCookies();

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const url = new URL(raw, ORIGIN);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: url.pathname });

    const headers = new Headers(init.headers);
    if (cookieJar.size > 0) {
      headers.set('cookie', [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    headers.set('origin', ORIGIN);

    const response = await harness.handleApi(
      new Request(url, { method, headers, body: (init.body as BodyInit | null) ?? undefined }),
      url,
    );

    const cookieHeaders =
      (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      [response.headers.get('set-cookie') ?? ''].filter(Boolean);
    for (const rawCookie of cookieHeaders) {
      const pair = rawCookie.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (/max-age=0/i.test(rawCookie) || !value) cookieJar.delete(name);
      else cookieJar.set(name, value);
    }
    setScriptVisibleCookies();

    return response;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchImpl as typeof fetch;
  return requests;
}

async function signIn(harness: Harness) {
  // Same bootstrap the app performs: establish the CSRF cookie, then register.
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email: 'importer@example.com',
    password: 'long-enough-password',
    displayName: 'Importer',
  });
  expect(response.status).toBe(201);
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  cookieJar.clear();
  setScriptVisibleCookies();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

describe('chunked import — real client against the real route table', () => {
  it('initialises, uploads a chunk, reads progress and completes the job', async () => {
    const { harness, providers } = setup();
    await signIn(harness);
    const requests = installBrowserFetch(harness);

    // 1. POST /providers/import-init
    const { jobId, providerId } = await importInit({
      name: 'Client Flow Playlist',
      totalEntries: 2,
      totalChunks: 1,
      chunkSize: 1_000,
      fileSize: 512,
    });
    expect(jobId).toBeTruthy();
    expect(providerId).toBeTruthy();

    // 2. POST /providers/import-chunk/:jobId
    const chunk = await importChunk(jobId, {
      chunkIndex: 0,
      entries: [makeEntry(0), makeEntry(1)],
    });
    expect(chunk.importedEntries).toBe(2);

    // 3. GET /providers/import/:jobId/progress
    const progress = await getImportProgress(jobId);
    expect(progress.completedChunks).toBe(1);
    expect(progress.importedEntries).toBe(2);
    expect(progress.totalEntries).toBe(2);

    // 4. POST /providers/import-complete/:jobId
    const completed = await importComplete(jobId);
    expect(completed.provider.name).toBe('Client Flow Playlist');

    // 5. The provider really exists and owns the imported entries.
    const list = await harness.call('GET', '/api/providers');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { providers: { id: string; name: string }[] };
    expect(body.providers.map((provider) => provider.id)).toContain(completed.provider.id);
    expect(await providers.list((await currentUserId(harness))!)).toHaveLength(1);

    // Every client call used the documented route-table paths, once.
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/providers/import-init',
      'POST /api/providers/import-chunk/' + jobId,
      'GET /api/providers/import/' + jobId + '/progress',
      'POST /api/providers/import-complete/' + jobId,
    ]);
    expect(requests.some((request) => request.path.startsWith('/api/api'))).toBe(false);
  });

  it('cancels a job through the real DELETE route', async () => {
    const { harness } = setup();
    await signIn(harness);
    installBrowserFetch(harness);

    const { jobId } = await importInit({
      name: 'Cancelled Playlist',
      totalEntries: 1_000,
      totalChunks: 1,
      chunkSize: 1_000,
      fileSize: 1024,
    });

    await expect(importCancel(jobId)).resolves.toBeUndefined();

    // The job is gone after cancelling, so progress now reports not found.
    await expect(getImportProgress(jobId)).rejects.toMatchObject({ status: 404 });
  });

  it('never sends a doubled /api prefix for any import helper', async () => {
    const { harness } = setup();
    await signIn(harness);
    const requests = installBrowserFetch(harness);

    const { jobId } = await importInit({
      name: 'Prefix Check',
      totalEntries: 2,
      totalChunks: 2,
      chunkSize: 1_000,
      fileSize: 64,
    });
    await importChunk(jobId, { chunkIndex: 0, entries: [makeEntry(0)] });
    await getImportProgress(jobId);
    // Cancel while a chunk is still outstanding (a finished job cannot be cancelled).
    await importCancel(jobId);

    for (const request of requests) {
      expect(request.path.startsWith('/api/api/')).toBe(false);
      expect(request.path.startsWith('/api/providers/')).toBe(true);
    }
  });
});

async function currentUserId(harness: Harness): Promise<string | null> {
  const response = await harness.call('GET', '/api/auth/me');
  if (response.status !== 200) return null;
  const body = (await response.json()) as { user?: { id?: string } };
  return body.user?.id ?? null;
}
