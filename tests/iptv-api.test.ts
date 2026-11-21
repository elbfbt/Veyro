import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { ProviderService } from '../worker/services/iptv/providerService';
import type {
  CatalogKeysView,
  ImportStats,
  M3uEntry,
  ProviderRepository,
  StoredProvider,
} from '../worker/services/iptv/types';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

class MemoryProviderRepository implements ProviderRepository {
  readonly providers = new Map<string, StoredProvider>();
  readonly catalog = new Map<string, M3uEntry[]>();

  private key(userId: string, id: string) {
    return `${userId}:${id}`;
  }

  async list(userId: string) {
    return [...this.providers.values()].filter((provider) => provider.userId === userId);
  }

  async find(userId: string, id: string) {
    return this.providers.get(this.key(userId, id)) ?? null;
  }

  async create(provider: StoredProvider) {
    if (provider.isDefault) {
      for (const existing of await this.list(provider.userId)) {
        this.providers.set(this.key(existing.userId, existing.id), { ...existing, isDefault: false });
      }
    }
    this.providers.set(this.key(provider.userId, provider.id), provider);
  }

  async update(userId: string, id: string, patch: Partial<StoredProvider>, now: number) {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    this.providers.set(this.key(userId, id), { ...provider, ...patch, updatedAt: now });
    return true;
  }

  async remove(userId: string, id: string) {
    return this.providers.delete(this.key(userId, id));
  }

  async setDefault(userId: string, id: string, now: number) {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    for (const existing of await this.list(userId)) {
      this.providers.set(this.key(userId, existing.id), { ...existing, isDefault: existing.id === id, updatedAt: now });
    }
    return true;
  }

  async loadCatalogKeys(): Promise<CatalogKeysView> {
    return {
      channels: new Map(),
      movies: new Map(),
      series: new Map(),
      episodes: new Map(),
      categories: new Map(),
    };
  }

  async saveCatalog(_userId: string, providerId: string, entries: M3uEntry[]) {
    this.catalog.set(providerId, entries);
    return { added: entries.length, updated: 0, categoriesAdded: 0 };
  }

  async saveImport(_userId: string, providerId: string, _checksum: string, _stats: ImportStats, now: number) {
    const provider = [...this.providers.values()].find((item) => item.id === providerId);
    if (provider) {
      this.providers.set(this.key(provider.userId, providerId), {
        ...provider,
        lastRefreshAt: now,
        status: 'active',
        metadata: {},
      });
    }
    return 'playlist-id';
  }
}

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
    expect(imported.status).toBe(201);
    expect((await imported.json()).imported).toBe(true);
    expect([...repository.catalog.values()][0]?.[0]?.name).toBe('BBC');

    const unsafe = await harness.call('POST', '/api/providers', {
      name: 'Local',
      type: 'm3u_url',
      url: 'http://127.0.0.1/secret',
    });
    expect(unsafe.status).toBe(400);
    expect((await unsafe.json()).error).toBe('unsafe_url');
  });
});
