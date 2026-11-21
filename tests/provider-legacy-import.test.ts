import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ContentService } from '../worker/services/content/service';
import { D1ContentRepository } from '../worker/services/content/repository';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { D1ProviderRepository } from '../worker/services/iptv/d1ProviderRepository';
import { ProviderService } from '../worker/services/iptv/providerService';
import { createHarness } from './helpers/apiHarness';
import {
  contentDatabaseAdapter,
  legacyProviderDatabaseAdapter,
  makeLegacyContentDatabase,
  type SqliteDatabase,
} from './helpers/contentSqlite';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

const USER_A = 'user-a';
const USER_B = 'user-b';

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="https://img.test/cnn.png" group-title="News",CNN
https://stream.test/cnn.m3u8
#EXTINF:-1 tvg-id="mv1" tvg-name="Alpha Film" tvg-logo="https://img.test/alpha.jpg" group-title="Movies",Alpha Film
https://stream.test/alpha.mp4
#EXTINF:-1 tvg-id="se1" tvg-name="Alpha Show" tvg-logo="https://img.test/show.jpg" group-title="Series",Alpha Show
https://stream.test/show.m3u8
#EXTINF:-1 tvg-id="ep1" tvg-name="Alpha Show S01E01" tvg-logo="https://img.test/show.jpg" group-title="Series",Alpha Show S01E01
https://stream.test/episode1.mp4
`;

function setup() {
  const database = makeLegacyContentDatabase([USER_A, USER_B]);
  const repository = new D1ProviderRepository(legacyProviderDatabaseAdapter(database) as never);
  const content = new ContentService(new D1ContentRepository(contentDatabaseAdapter(database) as never));
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: {
      newId: (() => {
        const queue = ['user-a', 'session-a', 'device-a', 'user-b', 'session-b', 'device-b'];
        let index = 0;
        return () => queue[index++] ?? `extra-${index}`;
      })(),
    },
  });
  let providerCounter = 0;
  const fetchPlaylist = vi.fn(async () => ({ text: PLAYLIST, bytes: PLAYLIST.length }));
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'),
    ids: { newId: () => `provider-${++providerCounter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist,
  });
  return {
    database,
    providers,
    fetchPlaylist,
    harnessA: createHarness(auth, 'https://veyro.test', providers, content),
    harnessB: createHarness(auth, 'https://veyro.test', providers, content),
  };
}

type Harness = ReturnType<typeof setup>['harnessA'];

async function register(harness: Harness, email: string) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email,
    password: 'long-enough-password',
    displayName: email.split('@')[0],
  });
  expect(response.status).toBe(201);
}

function rows(db: SqliteDatabase, sql: string, ...params: (string | number | null)[]): Array<Record<string, unknown>> {
  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

function uploadForm(content = PLAYLIST, name = 'Legacy playlist') {
  const form = new FormData();
  form.append('name', name);
  form.append('file', new Blob([content]), 'list.m3u8');
  return form;
}

describe('provider import against production legacy D1 schema', () => {
  it('imports a realistic M3U file into the legacy tables without a 500', async () => {
    const { database, harnessA } = setup();
    await register(harnessA, 'legacy-import@example.com');

    const response = await harnessA.call('POST', '/api/providers/import', undefined, {
      rawBody: uploadForm(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { imported: boolean; provider: { id: string; isDefault: boolean } };
    expect(body.imported).toBe(true);
    expect(body.provider.isDefault).toBe(true);

    const providers = rows(database, 'SELECT * FROM providers WHERE id = ?', body.provider.id);
    expect(providers).toMatchObject([{ user_id: USER_A, type: 'm3u_file', is_default: 1 }]);

    const playlists = rows(database, 'SELECT * FROM playlists WHERE provider_id = ?', body.provider.id);
    expect(playlists).toHaveLength(1);
    const playlistId = playlists[0]?.id as string;

    expect(rows(database, 'SELECT * FROM channels WHERE playlist_id = ?', playlistId)).toMatchObject([
      { name: 'CNN', tvg_id: 'cnn', tvg_name: 'CNN', logo_url: 'https://img.test/cnn.png', is_live: 1 },
    ]);
    expect(rows(database, 'SELECT * FROM movies WHERE playlist_id = ?', playlistId)).toMatchObject([
      { name: 'Alpha Film', logo_url: 'https://img.test/alpha.jpg' },
    ]);
    const series = rows(database, 'SELECT * FROM series WHERE playlist_id = ?', playlistId);
    expect(series).toMatchObject([{ name: 'Alpha Show', logo_url: 'https://img.test/show.jpg' }]);
    const episodes = rows(database, 'SELECT * FROM episodes');
    expect(episodes).toHaveLength(1);
    // The M3U parser classifies S01E01 entries as episodes but does not emit
    // series metadata, so the legacy row has no series link yet.
    expect(episodes[0]?.series_id).toBeNull();
    expect(episodes[0]?.name).toContain('Alpha Show');

    const categories = rows(database, 'SELECT * FROM categories WHERE playlist_id = ? ORDER BY sort_order', playlistId);
    expect(categories.map((category) => category.name)).toEqual(['News', 'Movies', 'Series']);
    expect(categories.every((category) => category.playlist_id === playlistId)).toBe(true);

    const moviesApi = await harnessA.call('GET', '/api/movies');
    expect(moviesApi.status).toBe(200);
    expect((await moviesApi.json()).movies).toHaveLength(1);
  });

  it('re-imports the same catalogue idempotently for URL providers', async () => {
    const { database, harnessA, fetchPlaylist } = setup();
    await register(harnessA, 'legacy-refresh@example.com');

    const created = await harnessA.call('POST', '/api/providers', {
      name: 'Legacy URL',
      type: 'm3u_url',
      url: 'https://provider.test/list.m3u8',
    });
    expect(created.status).toBe(201);
    const providerId = ((await created.json()) as { provider: { id: string } }).provider.id;

    const first = await harnessA.call('POST', `/api/providers/${providerId}/refresh`);
    expect(first.status).toBe(200);
    expect((await first.json()).added).toBe(4);

    const second = await harnessA.call('POST', `/api/providers/${providerId}/refresh`);
    expect(second.status).toBe(200);
    const secondStats = (await second.json()) as { added: number; updated: number };
    expect(secondStats.added).toBe(0);
    expect(secondStats.updated).toBe(4);
    expect(fetchPlaylist).toHaveBeenCalledTimes(2);

    expect(rows(database, 'SELECT id FROM channels')).toHaveLength(1);
    expect(rows(database, 'SELECT id FROM movies')).toHaveLength(1);
    expect(rows(database, 'SELECT id FROM series')).toHaveLength(1);
    expect(rows(database, 'SELECT id FROM episodes')).toHaveLength(1);
    expect(rows(database, 'SELECT id FROM categories')).toHaveLength(3);
    expect(rows(database, 'SELECT id FROM playlists WHERE provider_id = ?', providerId)).toHaveLength(1);
  });

  it('enforces provider, category and cross-user isolation after import', async () => {
    const { database, harnessA, harnessB } = setup();
    await register(harnessA, 'legacy-owner@example.com');
    await register(harnessB, 'legacy-other@example.com');

    const imported = await harnessA.call('POST', '/api/providers/import', undefined, { rawBody: uploadForm() });
    expect(imported.status).toBe(201);
    const providerId = ((await imported.json()) as { provider: { id: string } }).provider.id;
    const categoryId = rows(database, 'SELECT id FROM categories WHERE name = ?', 'Movies')[0]?.id as string;

    expect((await harnessB.call('GET', `/api/providers/${providerId}`)).status).toBe(404);
    expect((await harnessB.call('DELETE', `/api/providers/${providerId}`)).status).toBe(404);
    expect((await harnessB.call('GET', `/api/movies?provider=${providerId}`)).status).toBe(404);
    expect((await harnessB.call('GET', `/api/movies?category=${categoryId}`)).status).toBe(404);

    const otherMovies = await harnessB.call('GET', '/api/movies');
    expect(otherMovies.status).toBe(200);
    expect((await otherMovies.json()).movies).toEqual([]);

    const ownMovies = await harnessA.call('GET', `/api/movies?provider=${providerId}&category=${categoryId}`);
    expect(ownMovies.status).toBe(200);
    expect((await ownMovies.json()).movies).toHaveLength(1);
  });
});
