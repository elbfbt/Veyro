import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { PlaylistFetchError } from '../worker/services/iptv/fetchPlaylist';
import type { BackgroundTaskScheduler } from '../worker/services/iptv/providerApi';
import { ProviderService } from '../worker/services/iptv/providerService';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';
import { MemoryProviderRepository } from './helpers/memoryProvider';

function setup() {
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `auth-${Math.random()}` },
  });
  const repository = new MemoryProviderRepository();
  let counter = 0;
  const fetchPlaylist = vi.fn(async () => ({
    text: '#EXTM3U\n#EXTINF:-1 tvg-id="cnn",CNN\nhttps://stream.example.com/cnn.m3u8\n',
    bytes: 60,
  }));
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'),
    ids: { newId: () => `provider-${++counter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist,
  });
  const harness = createHarness(auth, 'https://veyro.test', providers);
  const other = createHarness(auth, 'https://veyro.test', providers);
  return { auth, repository, providers, harness, other, fetchPlaylist };
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

async function createUrlProvider(harness: ReturnType<typeof setup>['harness']) {
  const response = await harness.call('POST', '/api/providers', {
    name: 'Main playlist',
    type: 'm3u_url',
    url: 'https://provider.example.com/playlist.m3u8',
  });
  expect(response.status).toBe(201);
  return (await response.json()).provider as { id: string };
}

describe('provider API', () => {
  it('requires an authenticated session and CSRF token', async () => {
    const { harness } = setup();
    expect((await harness.call('GET', '/api/providers', undefined, { cookie: false })).status).toBe(401);
    await register(harness, 'csrf@example.com');
    expect(
      (await harness.call('POST', '/api/providers', { name: 'x', type: 'm3u_url', url: 'https://a.test/x' }, { csrf: false })).status,
    ).toBe(403);
  });

  it('supports CRUD, default, test and refresh with ownership scoping', async () => {
    const { harness, other, repository, fetchPlaylist } = setup();
    await register(harness, 'owner@example.com');
    await register(other, 'other@example.com');

    const provider = await createUrlProvider(harness);
    expect((await harness.call('GET', '/api/providers')).status).toBe(200);
    expect((await other.call('GET', `/api/providers/${provider.id}`)).status).toBe(404);
    expect((await other.call('DELETE', `/api/providers/${provider.id}`)).status).toBe(404);

    const patched = await harness.call('PATCH', `/api/providers/${provider.id}`, { name: 'Renamed' });
    expect(patched.status).toBe(200);
    expect((await patched.json()).provider.name).toBe('Renamed');

    const tested = await harness.call('POST', `/api/providers/${provider.id}/test`);
    expect((await tested.json()).ok).toBe(true);
    expect(fetchPlaylist).toHaveBeenCalled();

    const refreshed = await harness.call('POST', `/api/providers/${provider.id}/refresh`);
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).added).toBe(1);
    expect(repository.catalog.get(provider.id)?.[0]?.name).toBe('CNN');

    const madeDefault = await harness.call('POST', `/api/providers/${provider.id}/default`);
    expect((await madeDefault.json()).provider.isDefault).toBe(true);

    expect((await harness.call('DELETE', `/api/providers/${provider.id}`)).status).toBe(200);
    expect((await harness.call('GET', `/api/providers/${provider.id}`)).status).toBe(404);
  });

  it('stores Xtream credentials encrypted and never returns the password', async () => {
    const { harness, repository } = setup();
    await register(harness, 'xtream@example.com');
    const response = await harness.call('POST', '/api/providers', {
      name: 'Xtream',
      type: 'xtream',
      serverUrl: 'https://xtream.example.com:8080',
      username: 'viewer',
      password: 'never-expose-this-password',
    });
    expect(response.status).toBe(201);
    const body = await response.text();
    expect(body).not.toContain('never-expose-this-password');
    expect(body).not.toContain('credentials_encrypted');

    const stored = [...repository.providers.values()][0];
    expect(stored?.serverUrl).toBe('https://xtream.example.com:8080/');
    expect(stored?.credentialsEncrypted).not.toContain('never-expose-this-password');
    expect(stored?.credentialsKeyId).toBe('aes-gcm-v1');
    expect(stored?.metadata).toMatchObject({ xtreamUsername: 'viewer' });
  });

  it('imports uploaded M3U files and rejects unsafe URLs', async () => {
    const { harness, repository } = setup();
    await register(harness, 'upload@example.com');

    const form = new FormData();
    form.append('name', 'Uploaded playlist');
    form.append('file', new Blob(['#EXTM3U\n#EXTINF:-1 tvg-id="bbc",BBC\nhttps://stream.example.com/bbc\n']), 'list.m3u8');
    const imported = await harness.call('POST', '/api/providers/import', undefined, { rawBody: form });
    expect(imported.status).toBe(200);
    const importedBody = await imported.json();
    expect(importedBody.imported).toBe(true);
    expect(importedBody.provider.serverUrl).toBe('');
    expect(importedBody.provider.playlistUrl).toBeNull();
    expect(importedBody.provider.type).toBe('m3u_file');
    expect([...repository.catalog.values()][0]?.[0]?.name).toBe('BBC');

    const unsafe = await harness.call('POST', '/api/providers', {
      name: 'Local',
      type: 'm3u_url',
      url: 'http://127.0.0.1/secret',
    });
    expect(unsafe.status).toBe(400);
    expect((await unsafe.json()).error).toBe('unsafe_url');
  });

  it('creates an M3U file provider with an empty (no) server URL', async () => {
    const { harness, repository } = setup();
    await register(harness, 'file@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Cooking',
      type: 'm3u_file',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.provider.serverUrl).toBe('');
    expect(body.provider.playlistUrl).toBeNull();
    expect(body.provider.type).toBe('m3u_file');
    expect(body.provider.xtreamUsername).toBeNull();

    const stored = [...repository.providers.values()][0];
    expect(stored?.serverUrl).toBe('');
    expect(stored?.type).toBe('m3u_file');
  });

  it('creates an M3U URL provider storing the playlist URL as serverUrl', async () => {
    const { harness, repository } = setup();
    await register(harness, 'url@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Main playlist',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.provider.serverUrl).toBe('https://provider.example.com/playlist.m3u8');
    expect(body.provider.playlistUrl).toBe('https://provider.example.com/playlist.m3u8');
    expect(body.provider.type).toBe('m3u_url');

    const stored = [...repository.providers.values()][0];
    expect(stored?.serverUrl).toBe('https://provider.example.com/playlist.m3u8');
  });

  it('imports a cooking.m3u file and stores an empty server URL', async () => {
    const { harness, repository } = setup();
    await register(harness, 'cooking@example.com');

    const cookingM3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" group-title="Cooking",CNN Cooking
https://stream.test/cnn.m3u8
#EXTINF:-1 tvg-id="bbc" tvg-name="BBC Food" group-title="Cooking",BBC Food
https://stream.test/bbc.m3u8
`;
    const form = new FormData();
    form.append('name', 'cooking');
    form.append('file', new Blob([cookingM3U]), 'cooking.m3u');
    const imported = await harness.call('POST', '/api/providers/import', undefined, {
      rawBody: form,
    });
    expect(imported.status).toBe(200);
    const body = await imported.json();
    expect(body.imported).toBe(true);
    expect(body.provider.serverUrl).toBe('');
    expect(body.provider.playlistUrl).toBeNull();
    expect(body.provider.type).toBe('m3u_file');
    expect(body.provider.xtreamUsername).toBeNull();
    expect([...repository.catalog.values()][0]?.[0]?.name).toBe('CNN Cooking');
  });

  /* ── Auto import on provider creation ────────────────────────── */

  it('M3U URL creation triggers automatic catalogue import', async () => {
    const { harness, fetchPlaylist } = setup();
    await register(harness, 'url-auto@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Auto URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    });
    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is active after auto-import completes
    expect(body.provider.status).toBe('active');
    expect(body.provider.importing).toBe(false);

    // fetchPlaylist was called during auto-import
    expect(fetchPlaylist).toHaveBeenCalled();

    // Catalogue is populated
    const providerId = body.provider.id;
    // Use the harness to list providers and find ours
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === providerId);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('active');
    expect(imported.lastImport?.totalEntries).toBeGreaterThan(0);
  });

  it('M3U URL creation does not falsely report success before import is known', async () => {
    const { harness, fetchPlaylist } = setup();
    await register(harness, 'url-nofail@example.com');

    // Make fetchPlaylist throw to simulate a failed import
    fetchPlaylist.mockRejectedValueOnce(new PlaylistFetchError());

    const response = await harness.call('POST', '/api/providers', {
      name: 'Failing URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    });

    // Creation still returns 201 (provider is preserved)
    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is in error state, not silently successful
    expect(body.provider.status).toBe('error');
    expect(body.provider.lastError).toBe('The provider could not be reached.');
    expect(body.provider.importing).toBe(false);
  });

  it('M3U URL failed import leaves provider retryable', async () => {
    const { harness, fetchPlaylist } = setup();
    await register(harness, 'url-retry@example.com');

    // First creation fails
    fetchPlaylist.mockRejectedValueOnce(new Error('upstream down'));
    const failed = await harness.call('POST', '/api/providers', {
      name: 'Retry URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    });
    expect(failed.status).toBe(201);
    const failedBody = await failed.json();
    expect(failedBody.provider.status).toBe('error');

    const providerId = failedBody.provider.id;

    // Provider exists in the list with error state
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === providerId);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('error');

    // Retry via refresh succeeds
    fetchPlaylist.mockResolvedValueOnce({
      text: '#EXTM3U\n#EXTINF:-1 tvg-id="cnn",CNN\nhttps://stream.example.com/cnn.m3u8\n',
      bytes: 60,
    });
    const refreshed = await harness.call('POST', `/api/providers/${providerId}/refresh`);
    expect(refreshed.status).toBe(200);
    const stats = await refreshed.json();
    expect(stats.added).toBe(1);

    // Provider is now active
    const listResp2 = await harness.call('GET', '/api/providers');
    const listBody2 = await listResp2.json();
    const active = listBody2.providers.find((p: { id: string }) => p.id === providerId);
    expect(active!.status).toBe('active');
  });

  it('ownership is enforced on auto-imported URL providers', async () => {
    const { harness, other } = setup();
    await register(harness, 'url-owner@example.com');
    await register(other, 'url-other@example.com');

    const response = await harness.call('POST', '/api/providers', {
      name: 'Owner URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    });
    expect(response.status).toBe(201);
    const providerId = (await response.json()).provider.id;

    // Other user cannot access the auto-imported provider
    expect((await other.call('GET', `/api/providers/${providerId}`)).status).toBe(404);
    expect((await other.call('DELETE', `/api/providers/${providerId}`)).status).toBe(404);
  });

  /* ── Background refresh on provider creation ─────────────────── */

  it('M3U URL creation returns promptly without waiting for remote import', async () => {
    const { harness, fetchPlaylist } = setup();
    await register(harness, 'url-bg@example.com');

    // Mock execution context that captures the background promise
    const backgroundPromises: Promise<unknown>[] = [];
    const scheduler: BackgroundTaskScheduler = {
      waitUntil: (promise: Promise<unknown>) => backgroundPromises.push(promise),
    };

    const response = await harness.call('POST', '/api/providers', {
      name: 'Background URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    }, { scheduler });

    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is refreshing, not active — import runs in background
    expect(body.provider.status).toBe('refreshing');
    expect(body.provider.importing).toBe(false);

    // Background task was scheduled
    expect(backgroundPromises).toHaveLength(1);

    // fetchPlaylist was kicked off (the promise started executing)
    expect(fetchPlaylist).toHaveBeenCalled();

    // Await the background import to completion
    await backgroundPromises[0];

    // After background import completes, provider is active and catalogue populated
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('active');
    expect(imported.lastImport?.totalEntries).toBeGreaterThan(0);
  });

  it('M3U URL background refresh failure leaves provider retryable with error state', async () => {
    const { harness, fetchPlaylist } = setup();
    await register(harness, 'url-bg-fail@example.com');

    // Make fetchPlaylist throw to simulate a failed import
    fetchPlaylist.mockRejectedValueOnce(new PlaylistFetchError());

    const backgroundPromises: Promise<unknown>[] = [];
    const scheduler: BackgroundTaskScheduler = {
      waitUntil: (promise: Promise<unknown>) => backgroundPromises.push(promise),
    };

    const response = await harness.call('POST', '/api/providers', {
      name: 'Background Failing URL',
      type: 'm3u_url',
      url: 'https://provider.example.com/playlist.m3u8',
    }, { scheduler });

    expect(response.status).toBe(201);
    const body = await response.json();

    // Provider is refreshing immediately (not waiting for import)
    expect(body.provider.status).toBe('refreshing');
    expect(backgroundPromises).toHaveLength(1);

    // Await the background import — it resolves because refresh() catches errors
    await backgroundPromises[0];

    // Provider is now in error state, retryable
    const listResp = await harness.call('GET', '/api/providers');
    const listBody = await listResp.json();
    const imported = listBody.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(imported).toBeDefined();
    expect(imported.status).toBe('error');
    expect(imported.lastError).toBe('The provider could not be reached.');

    // Retry via refresh succeeds
    fetchPlaylist.mockResolvedValueOnce({
      text: '#EXTM3U\n#EXTINF:-1 tvg-id="cnn",CNN\nhttps://stream.example.com/cnn.m3u8\n',
      bytes: 60,
    });
    const refreshed = await harness.call('POST', `/api/providers/${body.provider.id}/refresh`);
    expect(refreshed.status).toBe(200);
    const stats = await refreshed.json();
    expect(stats.added).toBe(1);

    // Provider is now active
    const listResp2 = await harness.call('GET', '/api/providers');
    const listBody2 = await listResp2.json();
    const active = listBody2.providers.find((p: { id: string }) => p.id === body.provider.id);
    expect(active!.status).toBe('active');
  });
});
