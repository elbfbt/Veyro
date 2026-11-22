import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { createBoundedTextFetcher } from '../worker/services/iptv/fetchPlaylist';
import type { BackgroundTaskScheduler } from '../worker/services/iptv/providerApi';
import { ProviderService } from '../worker/services/iptv/providerService';
import { XtreamClient } from '../worker/services/iptv/xtreamClient';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';
import { MemoryProviderRepository } from './helpers/memoryProvider';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PASSWORD = 'xtream-secret-that-must-never-leak';
const SERVER = 'https://xtream.example.com:8080';

type Responder = (url: URL) => Response | unknown;

function catalogue(action: string, seriesId?: string): unknown {
  switch (action) {
    case 'get_live_categories':
      return [{ category_id: '1', category_name: 'News' }];
    case 'get_vod_categories':
      return [{ category_id: '2', category_name: 'Movies' }];
    case 'get_series_categories':
      return [{ category_id: '3', category_name: 'Shows' }];
    case 'get_live_streams':
      return [{ stream_id: '10', name: 'CNN', category_id: '1', stream_icon: 'https://img.test/cnn.png', num: '101' }];
    case 'get_vod_streams':
      return [{ stream_id: '20', name: 'A Film', category_id: '2', stream_icon: 'https://img.test/film.png' }];
    case 'get_series':
      return [{ series_id: '30', name: 'A Show', category_id: '3', cover: 'https://img.test/show.png' }];
    case 'get_series_info':
      if (seriesId !== '30') return { episodes: {} };
      return { episodes: { 1: [{ id: '40', title: 'Pilot', season: 1, episode_num: 1, container_extension: 'mkv' }] } };
    default:
      return [];
  }
}

function setup(options: { maxBytes?: number; timeoutMs?: number; maxSeriesDetails?: number } = {}) {
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `auth-${Math.random()}` },
  });
  const repository = new MemoryProviderRepository();
  let responder: Responder = (url) => catalogue(url.searchParams.get('action') ?? '', url.searchParams.get('series_id') ?? undefined);
  const calls: URL[] = [];

  let fetchOverride: typeof fetch | null = null;
  const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = responder(url);
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 });
  }) as unknown as typeof fetch;
  const fetchImpl: typeof fetch = (input, init) =>
    fetchOverride ? fetchOverride(input, init) : baseFetch(input, init);

  let counter = 0;
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher(SECRET),
    ids: { newId: () => `provider-${++counter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist: vi.fn(async () => ({ text: '', bytes: 0 })),
    xtreamClient: new XtreamClient({
      fetchText: createBoundedTextFetcher({ fetchImpl, verifyDns: false, accept: 'application/json' }),
      timeoutMs: options.timeoutMs ?? 10_000,
      maxResponseBytes: options.maxBytes,
      maxSeriesDetails: options.maxSeriesDetails,
    }),
    maxBytes: options.maxBytes,
  });
  const harness = createHarness(auth, 'https://veyro.test', providers);
  const other = createHarness(auth, 'https://veyro.test', providers);
  return {
    auth,
    repository,
    providers,
    harness,
    other,
    calls,
    setResponder(next: Responder) {
      responder = next;
    },
    setFetch(next: typeof fetch) {
      fetchOverride = next;
    },
  };
}

async function register(harness: ReturnType<typeof setup>['harness'], email: string) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email,
    password: 'long-enough-password',
    displayName: email.split('@')[0],
  });
  expect(response.status).toBe(201);
}

async function createXtreamProvider(harness: ReturnType<typeof setup>['harness'], serverUrl = SERVER) {
  const response = await harness.call('POST', '/api/providers', {
    name: 'My Xtream',
    type: 'xtream',
    serverUrl,
    username: 'viewer',
    password: PASSWORD,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { provider: { id: string } }).provider.id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Xtream catalogue import', () => {
  it('decrypts credentials server-side and imports all catalogue types', async () => {
    const { harness, repository, calls } = setup();
    await register(harness, 'xtream-success@example.com');

    // Creation triggers the initial import automatically.
    const created = await harness.call('POST', '/api/providers', {
      name: 'My Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.provider.status).toBe('active');
    const id = createdBody.provider.id;

    // Catalogue is populated by the auto-import.
    const entries = repository.catalog.get(id) ?? [];
    expect(entries.map((entry) => entry.kind)).toEqual(['channel', 'movie', 'series', 'episode']);
    expect(entries[0]).toMatchObject({ externalId: 'xtream:live:10', name: 'CNN', channelNumber: '101' });
    expect(entries[1]).toMatchObject({ externalId: 'xtream:movie:20', kind: 'movie', posterUrl: 'https://img.test/film.png' });
    expect(entries[2]).toMatchObject({ externalId: 'xtream:series:30', kind: 'series', categoryExternalId: 'xtream:series:3' });
    expect(entries[3]).toMatchObject({
      externalId: 'xtream:episode:40',
      kind: 'episode',
      seriesExternalId: 'xtream:series:30',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    expect(repository.categories.get(id)?.map((category) => category.type)).toEqual(['channel', 'movie', 'series']);

    // Auto-import made the expected Xtream API calls.
    const importActions = calls.map((url) => url.searchParams.get('action'));
    expect(importActions).toEqual([
      'get_live_categories',
      'get_vod_categories',
      'get_series_categories',
      'get_live_streams',
      'get_vod_streams',
      'get_series',
      'get_series_info',
    ]);
    for (const url of calls) {
      expect(url.origin).toBe(SERVER);
      expect(url.pathname).toBe('/player_api.php');
      expect(url.searchParams.get('username')).toBe('viewer');
      expect(url.searchParams.get('password')).toBe(PASSWORD);
    }
    expect(calls[6]?.searchParams.get('series_id')).toBe('30');
    expect(calls.some((url) => url.hostname === '127.0.0.1')).toBe(false);

    // Explicit refresh re-imports — MemoryProviderRepository reports all as added
    // (duplicate detection is a D1-layer concern; memory repo always overwrites).
    const refresh = await harness.call('POST', `/api/providers/${id}/refresh`, {
      serverUrl: 'http://127.0.0.1/attacker',
      username: 'attacker',
      password: 'attacker-value',
    });
    expect(refresh.status).toBe(200);
    const stats = (await refresh.json()) as Record<string, number>;
    expect(stats).toMatchObject({ totalEntries: 4, added: 4, skipped: 0, duplicates: 0, categoriesAdded: 3 });
  });

  it('tests the connection using decrypted credentials without exposing them', async () => {
    const { harness, calls } = setup();
    await register(harness, 'xtream-test@example.com');
    const id = await createXtreamProvider(harness);
    const response = await harness.call('POST', `/api/providers/${id}/test`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
    // Auto-import made calls during creation; the test connection call is the last one.
    const testCall = calls[calls.length - 1];
    expect(testCall?.searchParams.get('action')).toBe('get_live_categories');
    expect(testCall?.searchParams.get('password')).toBe(PASSWORD);
  });

  it('never exposes the password, upstream URL or credential material to the client', async () => {
    const logs: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => String(arg)).join(' '));
      });
    }
    const { harness, calls } = setup();
    await register(harness, 'xtream-security@example.com');
    const id = await createXtreamProvider(harness);

    const refreshed = await harness.call('POST', `/api/providers/${id}/refresh`);
    expect(refreshed.status).toBe(200);
    const bodies = [await refreshed.text()];
    const listed = await harness.call('GET', '/api/providers');
    bodies.push(await listed.text());
    const single = await harness.call('GET', `/api/providers/${id}`);
    bodies.push(await single.text());

    for (const body of bodies) {
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain('password=');
      expect(body).not.toContain('player_api.php');
      expect(body).not.toContain('credentials_encrypted');
    }
    expect(logs.join('\n')).not.toContain(PASSWORD);
    expect(calls.length).toBeGreaterThan(0);

    const sources = ['src/features/settings/ProvidersSection.tsx', 'src/features/settings/SettingsPage.tsx', 'src/lib/api.ts', 'src/types/providers.ts'];
    const clientCode = sources.map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
    expect(clientCode).not.toContain(PASSWORD);
    expect(clientCode).not.toContain('player_api.php');
    expect(clientCode).not.toContain('VEYRO_PROVIDER_SECRET');
    expect(clientCode).not.toMatch(/localStorage|sessionStorage/);
  });

  it('enforces ownership and CSRF before any upstream request', async () => {
    const { harness, other, calls } = setup();
    await register(harness, 'owner-xtream@example.com');
    await register(other, 'other-xtream@example.com');
    const id = await createXtreamProvider(harness);

    // Auto-import already made calls during creation. Clear to track refresh-specific calls.
    calls.splice(0, calls.length);

    const noCsrf = await harness.call('POST', `/api/providers/${id}/refresh`, undefined, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(calls).toHaveLength(0);

    const crossUser = await other.call('POST', `/api/providers/${id}/refresh`);
    expect(crossUser.status).toBe(404);
    expect(calls).toHaveLength(0);
    expect(((await crossUser.json()) as { error: string }).error).toBe('not_found');
  });
});

describe('Xtream failure handling', () => {
  it('maps bad credentials to a safe authentication error', async () => {
    const { harness, setResponder } = setup();
    await register(harness, 'bad-creds@example.com');
    const id = await createXtreamProvider(harness);
    setResponder(() => new Response('unauthorized', { status: 401 }));

    const response = await harness.call('POST', `/api/providers/${id}/refresh`);
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('provider_authentication_failed');
    expect(body).not.toContain(PASSWORD);
    const provider = ((await (await harness.call('GET', `/api/providers/${id}`)).json()) as { provider: { lastError: string } }).provider;
    expect(provider.lastError).toBe('Provider authentication failed.');
  });

  it('does not leak errors from unreachable providers', async () => {
    const { harness, setFetch } = setup();
    await register(harness, 'unreachable@example.com');
    const id = await createXtreamProvider(harness);
    setFetch(
      vi.fn(async () => {
        throw new Error(`internal detail ${PASSWORD}`);
      }) as unknown as typeof fetch,
    );

    const response = await harness.call('POST', `/api/providers/${id}/refresh`);
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('provider_unreachable');
    expect(body).not.toContain(PASSWORD);
  });

  it('rejects malformed, empty and oversized catalogue responses safely', async () => {
    const malformed = setup();
    await register(malformed.harness, 'malformed@example.com');
    const malformedId = await createXtreamProvider(malformed.harness);
    malformed.setResponder(() => ({ unexpected: true }));
    const bad = await malformed.harness.call('POST', `/api/providers/${malformedId}/refresh`);
    expect(bad.status).toBe(502);
    expect((await bad.text())).toContain('invalid_provider_response');

    const empty = setup();
    await register(empty.harness, 'empty@example.com');
    const emptyId = await createXtreamProvider(empty.harness);
    empty.setResponder(() => []);
    const none = await empty.harness.call('POST', `/api/providers/${emptyId}/refresh`);
    expect(none.status).toBe(200);
    expect((await none.json()) as { totalEntries: number }).toMatchObject({ totalEntries: 0, added: 0 });

    const large = setup({ maxBytes: 80 });
    await register(large.harness, 'large@example.com');
    const largeId = await createXtreamProvider(large.harness);
    large.setResponder(() => new Response('x'.repeat(5000), { status: 200 }));
    const tooLarge = await large.harness.call('POST', `/api/providers/${largeId}/refresh`);
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.text())).toContain('provider_response_too_large');
  });

  it('blocks private destinations and unsafe redirects', async () => {
    const invalid = setup();
    await register(invalid.harness, 'invalid-url@example.com');
    const rejectedCreate = await invalid.harness.call('POST', '/api/providers', {
      name: 'Local',
      type: 'xtream',
      serverUrl: 'http://127.0.0.1',
      username: 'viewer',
      password: PASSWORD,
    });
    expect(rejectedCreate.status).toBe(400);

    const validId = await createXtreamProvider(invalid.harness);
    // Auto-import made calls during creation; clear to track refresh-specific calls.
    invalid.calls.splice(0, invalid.calls.length);

    const provider = await invalid.repository.find('user-tamper', validId);
    const stored = provider ?? [...invalid.repository.providers.values()].find((item) => item.id === validId);
    if (!stored) throw new Error('provider was not stored');
    invalid.repository.providers.set(`${stored.userId}:${stored.id}`, { ...stored, serverUrl: 'http://127.0.0.1:8080' });
    const unsafe = await invalid.harness.call('POST', `/api/providers/${validId}/refresh`);
    expect(unsafe.status).toBe(400);
    expect((await unsafe.text())).toContain('unsafe_provider_url');
    expect(invalid.calls).toHaveLength(0);

    const redirect = setup();
    await register(redirect.harness, 'redirect@example.com');
    const redirectId = await createXtreamProvider(redirect.harness);
    redirect.setResponder(() => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
    const unsafeRedirect = await redirect.harness.call('POST', `/api/providers/${redirectId}/refresh`);
    expect(unsafeRedirect.status).toBe(400);
    expect((await unsafeRedirect.text())).toContain('unsafe_provider_url');
  });

  it('returns a safe timeout error', async () => {
    const { harness, setFetch } = setup({ timeoutMs: 5 });
    await register(harness, 'timeout@example.com');
    const id = await createXtreamProvider(harness);
    setFetch(
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ) as unknown as typeof fetch,
    );

    const response = await harness.call('POST', `/api/providers/${id}/refresh`);
    expect(response.status).toBe(504);
    const body = await response.text();
    expect(body).toContain('provider_timeout');
    expect(body).not.toContain(PASSWORD);
  });

  /* ── Xtream auto import on creation ─────────────────────────── */

  it('Xtream creation triggers automatic catalogue import', async () => {
    const { harness, repository, calls } = setup();
    await register(harness, 'xtream-auto@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Auto Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is active after auto-import
    expect(body.provider.status).toBe('active');
    expect(body.provider.importing).toBe(false);

    // Catalogue is populated
    const providerId = body.provider.id;
    const stored = repository.catalog.get(providerId);
    expect(stored).toBeDefined();
    expect(stored!.length).toBeGreaterThan(0);

    // Xtream API calls were made during auto-import
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.origin).toBe(SERVER);
      expect(url.searchParams.get('username')).toBe('viewer');
      expect(url.searchParams.get('password')).toBe(PASSWORD);
    }
  });

  it('Xtream creation does not expose credentials to the client', async () => {
    const { harness } = setup();
    await register(harness, 'xtream-secret@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Secret Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    });
    expect(response.status).toBe(201);

    const body = await response.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain('credentials_encrypted');

    // List also doesn't expose credentials
    const listed = await harness.call('GET', '/api/providers');
    const listedBody = await listed.text();
    expect(listedBody).not.toContain(PASSWORD);
    expect(listedBody).not.toContain('credentials_encrypted');
  });

  it('Xtream failed import leaves provider retryable with error state', async () => {
    const { harness, setResponder } = setup();
    await register(harness, 'xtream-fail@example.com');

    // Make the upstream return 401 so auto-import fails
    setResponder(() => new Response('unauthorized', { status: 401 }));

    const response = await harness.call('POST', '/api/providers', {
      name: 'Failing Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is in error state, not silently successful
    expect(body.provider.status).toBe('error');
    expect(body.provider.lastError).toContain('authentication');
    expect(body.provider.importing).toBe(false);

    const providerId = body.provider.id;

    // Provider exists in list with error state
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === providerId);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('error');

    // Retry via refresh succeeds with good credentials
    setResponder((url) => catalogue(url.searchParams.get('action') ?? '', url.searchParams.get('series_id') ?? undefined));
    const refreshed = await harness.call('POST', `/api/providers/${providerId}/refresh`);
    expect(refreshed.status).toBe(200);

    // Provider is now active
    const listResp2 = await harness.call('GET', '/api/providers');
    const listBody2 = await listResp2.json();
    const active = listBody2.providers.find((p: { id: string }) => p.id === providerId);
    expect(active!.status).toBe('active');
  });

  it('ownership is enforced on auto-imported Xtream providers', async () => {
    const { harness, other } = setup();
    await register(harness, 'xtream-owner@example.com');
    await register(other, 'xtream-other@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Owner Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    const providerId = (await response.json()).provider.id;

    // Other user cannot access the auto-imported provider
    expect((await other.call('GET', `/api/providers/${providerId}`)).status).toBe(404);
    expect((await other.call('DELETE', `/api/providers/${providerId}`)).status).toBe(404);
  });

  /* ── Xtream background refresh on creation ─────────────────── */

  it('Xtream creation returns promptly without waiting for catalogue import', async () => {
    const { harness, calls, repository } = setup();
    await register(harness, 'xtream-bg@example.com');

    const backgroundPromises: Promise<unknown>[] = [];
    const scheduler: BackgroundTaskScheduler = {
      waitUntil: (promise: Promise<unknown>) => backgroundPromises.push(promise),
    };

    const response = await harness.call('POST', '/api/providers', {
      name: 'Background Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    }, { scheduler });

    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is refreshing, not active — import runs in background
    expect(body.provider.status).toBe('refreshing');
    expect(body.provider.importing).toBe(false);

    // Background task was scheduled
    expect(backgroundPromises).toHaveLength(1);

    // Await the background import to completion (microtasks run)
    await backgroundPromises[0];

    // After background import completes, Xtream API calls were made
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.origin).toBe(SERVER);
      expect(url.searchParams.get('username')).toBe('viewer');
      expect(url.searchParams.get('password')).toBe(PASSWORD);
    }

    // Provider is active and catalogue populated
    const stored = repository.catalog.get(body.provider.id);
    expect(stored).toBeDefined();
    expect(stored!.length).toBeGreaterThan(0);

    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('active');
  });

  it('Xtream background refresh failure leaves provider retryable with error state', async () => {
    const { harness, setResponder, calls } = setup();
    await register(harness, 'xtream-bg-fail@example.com');

    // Make the upstream return 401 so auto-import fails
    setResponder(() => new Response('unauthorized', { status: 401 }));

    const backgroundPromises: Promise<unknown>[] = [];
    const scheduler: BackgroundTaskScheduler = {
      waitUntil: (promise: Promise<unknown>) => backgroundPromises.push(promise),
    };

    const response = await harness.call('POST', '/api/providers', {
      name: 'Background Failing Xtream',
      type: 'xtream',
      serverUrl: SERVER,
      username: 'viewer',
      password: PASSWORD,
    }, { scheduler });

    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is refreshing immediately (not waiting for import)
    expect(body.provider.status).toBe('refreshing');
    expect(backgroundPromises).toHaveLength(1);

    // Await the background import — it resolves because refresh() catches errors
    await backgroundPromises[0];

    // After background import completes, Xtream API calls were made
    expect(calls.length).toBeGreaterThan(0);

    // Provider is now in error state, retryable
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('error');
    expect(imported.lastError).toContain('authentication');

    // Retry via refresh succeeds with good credentials
    setResponder((url) => catalogue(url.searchParams.get('action') ?? '', url.searchParams.get('series_id') ?? undefined));
    const refreshed = await harness.call('POST', `/api/providers/${body.provider.id}/refresh`);
    expect(refreshed.status).toBe(200);

    // Provider is now active
    const listResp2 = await harness.call('GET', '/api/providers');
    const listBody2 = await listResp2.json();
    const active = listBody2.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(active!.status).toBe('active');
  });
});
