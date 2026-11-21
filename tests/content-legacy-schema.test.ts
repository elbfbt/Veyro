import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { D1ContentRepository } from '../worker/services/content/repository';
import { ContentService } from '../worker/services/content/service';
import { createHarness } from './helpers/apiHarness';
import { contentDatabaseAdapter, makeLegacyContentDatabase, type SqliteDatabase } from './helpers/contentSqlite';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

const USER_A = 'user-a';
const USER_B = 'user-b';

function seed(db: SqliteDatabase) {
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);

  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-a', USER_A, 'Provider A', 'm3u_url', 1);
  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-a2', USER_A, 'Provider A Two', 'm3u_file', 0);
  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-b', USER_B, 'Provider B', 'm3u_url', 1);

  run('INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'pl-a', 'prov-a', 'A import', 100, 110);
  run('INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'pl-a2', 'prov-a2', 'A2 import', 300, 310);
  run('INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'pl-b', 'prov-b', 'B import', 200, 210);

  run('INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)', 'cat-a-news', 'pl-a', 'News', 'channel', 1);
  run('INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)', 'cat-a-movies', 'pl-a', 'Movies', 'movie', 2);
  run('INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)', 'cat-a-series', 'pl-a', 'Drama', 'series', 3);
  run('INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)', 'cat-b-news', 'pl-b', 'Secret', 'channel', 1);

  run(
    'INSERT INTO movies (id, playlist_id, category_id, name, stream_url, logo_url, year, duration, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'mv-a1', 'pl-a', 'cat-a-movies', 'Alpha Film', 'https://stream.test/m1', 'https://img.test/alpha.png', 2021, 5400, 'A film',
  );
  run(
    'INSERT INTO movies (id, playlist_id, category_id, name, stream_url, logo_url, year, duration, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'mv-a2', 'pl-a2', null, 'Zulu Film', 'https://stream.test/m2', 'javascript:alert(1)', 2022, 3600, null,
  );
  run(
    'INSERT INTO movies (id, playlist_id, category_id, name, stream_url, year) VALUES (?, ?, ?, ?, ?, ?)',
    'mv-b1', 'pl-b', null, 'Secret Film', 'https://stream.test/m3', 2023,
  );

  run(
    'INSERT INTO channels (id, playlist_id, category_id, name, stream_url, logo_url, tvg_id, tvg_name, is_live) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ch-a1', 'pl-a', 'cat-a-news', 'Alpha News', 'https://stream.test/c1', 'javascript:alert(1)', 'alpha', 'Alpha TV', 1,
  );
  run(
    'INSERT INTO channels (id, playlist_id, category_id, name, stream_url) VALUES (?, ?, ?, ?, ?)',
    'ch-b1', 'pl-b', 'cat-b-news', 'Secret Channel', 'https://stream.test/c2',
  );

  run(
    'INSERT INTO series (id, playlist_id, category_id, name, logo_url, year, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'se-a1', 'pl-a', 'cat-a-series', 'Alpha Show', 'https://img.test/show.png', 2020, 'A series',
  );
  run(
    'INSERT INTO series (id, playlist_id, category_id, name, year) VALUES (?, ?, ?, ?, ?)',
    'se-b1', 'pl-b', null, 'Secret Show', 2019,
  );

  run(
    'INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url, duration, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'ep-a2', 'se-a1', 1, 2, 'Second', 'xtream://episode/2', 1800, 'Second episode',
  );
  run(
    'INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'ep-a1', 'se-a1', 1, 1, 'First', 'xtream://episode/1', 1800,
  );
  run(
    'INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url) VALUES (?, ?, ?, ?, ?, ?)',
    'ep-a3', 'se-a1', 2, 1, 'Finale', 'xtream://episode/3',
  );
  run(
    'INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url) VALUES (?, ?, ?, ?, ?, ?)',
    'ep-b1', 'se-b1', 1, 1, 'Secret Episode', 'xtream://episode/4',
  );
}

type Harness = ReturnType<typeof setup>['harnessA'];

function setup(options: { seedData?: boolean } = {}) {
  const database = makeLegacyContentDatabase([USER_A, USER_B]);
  if (options.seedData !== false) seed(database);
  const content = new ContentService(new D1ContentRepository(contentDatabaseAdapter(database) as never));
  const authRepository = new MemoryAuthRepository();
  let counter = 0;
  const idQueue = ['user-a', 'session-a', 'device-a', 'user-b', 'session-b', 'device-b'];
  const auth = new AuthService({
    repository: authRepository,
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => idQueue[counter++] ?? `extra-${counter}` },
  });
  return {
    content,
    database,
    harnessA: createHarness(auth, 'https://veyro.test', undefined, content),
    harnessB: createHarness(auth, 'https://veyro.test', undefined, content),
  };
}

async function register(harness: Harness, email: string) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email,
    password: 'long-enough-password',
    displayName: email.split('@')[0],
  });
  expect(response.status).toBe(201);
}

interface PaginationBody {
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
}
type MoviesBody = PaginationBody & {
  movies: Array<{ id: string; title: string; posterUrl: string | null; durationSec: number | null; createdAt: number }>;
};
type ChannelsBody = PaginationBody & {
  channels: Array<{ id: string; name: string; logoUrl: string | null; categoryName: string | null }>;
};
type SeriesBody = PaginationBody & { series: Array<{ id: string; title: string; posterUrl: string | null }> };
type CategoriesBody = PaginationBody & { categories: Array<{ id: string; name: string; type: string; itemCount: number }> };
type EpisodesBody = PaginationBody & { episodes: Array<{ id: string; title: string; seasonNumber: number | null; episodeNumber: number | null }> };

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('Phase 4 catalogue against production legacy D1 schema', () => {
  it('returns 200 for the exact failing production request on an empty catalogue', async () => {
    const { harnessA } = setup({ seedData: false });
    await register(harnessA, 'legacy-empty@example.com');

    const response = await harnessA.call('GET', '/api/movies?sort=recent&limit=8');
    expect(response.status).toBe(200);
    const body = await json<MoviesBody>(response);
    expect(body.movies).toEqual([]);
    expect(body.pagination).toMatchObject({ page: 1, limit: 8, total: 0, totalPages: 1, hasMore: false });
  });

  it('maps legacy movie columns into the Phase 4 response contract', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-movies@example.com');

    const response = await harnessA.call('GET', '/api/movies?sort=recent&limit=8');
    expect(response.status).toBe(200);
    const body = await json<MoviesBody>(response);
    expect(body.movies.map((movie) => movie.id)).toEqual(['mv-a2', 'mv-a1']);
    expect(body.movies[1]).toMatchObject({
      title: 'Alpha Film',
      posterUrl: 'https://img.test/alpha.png',
      durationSec: 5400,
      createdAt: 100,
    });
    expect(body.movies[0]?.posterUrl).toBeNull();
    expect(body.movies[0]?.createdAt).toBe(300);
  });

  it('lists channels, series and categories through playlist ownership', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-lists@example.com');

    const channels = await json<ChannelsBody>(await harnessA.call('GET', '/api/channels?sort=recent'));
    expect(channels.channels).toHaveLength(1);
    expect(channels.channels[0]).toMatchObject({
      id: 'ch-a1',
      name: 'Alpha News',
      logoUrl: null,
      categoryName: 'News',
    });

    const series = await json<SeriesBody>(await harnessA.call('GET', '/api/series'));
    expect(series.series).toMatchObject([{ id: 'se-a1', title: 'Alpha Show', posterUrl: 'https://img.test/show.png' }]);

    const categories = await json<CategoriesBody>(await harnessA.call('GET', '/api/categories?type=movie'));
    expect(categories.categories).toMatchObject([{ id: 'cat-a-movies', name: 'Movies', type: 'movie', itemCount: 1 }]);
  });

  it('supports provider, category, search and pagination filters', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-filters@example.com');

    const byProvider = await json<MoviesBody>(await harnessA.call('GET', '/api/movies?provider=prov-a2'));
    expect(byProvider.movies.map((movie) => movie.id)).toEqual(['mv-a2']);

    const byCategory = await json<MoviesBody>(await harnessA.call('GET', '/api/movies?category=cat-a-movies'));
    expect(byCategory.movies.map((movie) => movie.id)).toEqual(['mv-a1']);

    const searched = await json<MoviesBody>(await harnessA.call('GET', '/api/movies?q=alpha'));
    expect(searched.movies.map((movie) => movie.id)).toEqual(['mv-a1']);

    const channelSearch = await json<ChannelsBody>(await harnessA.call('GET', '/api/channels?q=Alpha TV'));
    expect(channelSearch.channels.map((channel) => channel.id)).toEqual(['ch-a1']);

    const paged = await json<MoviesBody>(await harnessA.call('GET', '/api/movies?sort=title&page=2&limit=1'));
    expect(paged.movies.map((movie) => movie.id)).toEqual(['mv-a2']);
    expect(paged.pagination).toMatchObject({ page: 2, limit: 1, total: 2, hasMore: false });
  });

  it('serves details and ordered episodes without exposing stream URLs', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-details@example.com');

    const movie = await harnessA.call('GET', '/api/movies/mv-a1');
    expect(movie.status).toBe(200);
    const movieBody = await json<{ movie: MoviesBody['movies'][number] & { streamUrl?: string } }>(movie);
    expect(movieBody.movie.title).toBe('Alpha Film');
    expect(movieBody.movie.streamUrl).toBeUndefined();

    const channel = await harnessA.call('GET', '/api/channels/ch-a1');
    expect(channel.status).toBe(200);

    const detail = await harnessA.call('GET', '/api/series/se-a1');
    expect(detail.status).toBe(200);

    const episodes = await json<EpisodesBody>(await harnessA.call('GET', '/api/series/se-a1/episodes'));
    expect(episodes.episodes.map((episode) => episode.id)).toEqual(['ep-a1', 'ep-a2', 'ep-a3']);

    const episode = await harnessA.call('GET', '/api/episodes/ep-a2');
    expect(episode.status).toBe(200);
    const episodeBody = await json<{ episode: { title: string; seriesTitle: string; providerName: string } }>(episode);
    expect(episodeBody.episode).toMatchObject({
      title: 'Second',
      seriesTitle: 'Alpha Show',
      providerName: 'Provider A',
    });
  });

  it('blocks cross-user IDOR through every legacy ownership path', async () => {
    const { harnessA, harnessB } = setup();
    await register(harnessA, 'legacy-owner@example.com');
    await register(harnessB, 'legacy-intruder@example.com');

    for (const path of [
      '/api/channels/ch-a1',
      '/api/movies/mv-a1',
      '/api/series/se-a1',
      '/api/series/se-a1/episodes',
      '/api/episodes/ep-a1',
      '/api/movies?provider=prov-a',
      '/api/movies?category=cat-a-movies',
      '/api/categories?provider=prov-a',
    ]) {
      const response = await harnessB.call('GET', path);
      expect(response.status, path).toBe(404);
    }

    const own = await json<MoviesBody>(await harnessB.call('GET', '/api/movies'));
    expect(own.movies.map((movie) => movie.id)).toEqual(['mv-b1']);
  });
});

describe('stream resolution API (legacy schema)', () => {
  it('resolves M3U channel stream for owner through playlist ownership', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-stream-channel@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-a1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/c1' });
  });

  it('resolves M3U movie stream for owner through playlist ownership', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-stream-movie@example.com');

    const response = await harnessA.call('GET', '/api/movies/mv-a1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/m1' });
  });

  it('resolves M3U channel stream for owner via playlist ownership', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-stream-file@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-a1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/c1' });
  });

  it('rejects unauthenticated legacy stream requests', async () => {
    const { harnessA } = setup();
    for (const path of ['/api/channels/ch-a1/stream', '/api/movies/mv-a1/stream', '/api/episodes/ep-a1/stream']) {
      expect((await harnessA.call('GET', path, undefined, { cookie: false })).status).toBe(401);
    }
  });

  it('prevents cross-user legacy stream resolution', async () => {
    const { harnessA, harnessB } = setup();
    await register(harnessA, 'legacy-stream-owner@example.com');
    await register(harnessB, 'legacy-stream-intruder@example.com');

    for (const path of ['/api/channels/ch-a1/stream', '/api/movies/mv-a1/stream', '/api/episodes/ep-a1/stream']) {
      expect((await harnessB.call('GET', path)).status).toBe(404);
    }
  });

  it('keeps stream_url out of normal legacy detail responses', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-stream-nostream@example.com');

    const channel = await harnessA.call('GET', '/api/channels/ch-a1');
    expect((await channel.json()).channel).not.toHaveProperty('streamUrl');

    const movie = await harnessA.call('GET', '/api/movies/mv-a1');
    expect((await movie.json()).movie).not.toHaveProperty('streamUrl');

    const episode = await harnessA.call('GET', '/api/episodes/ep-a1');
    expect((await episode.json()).episode).not.toHaveProperty('streamUrl');
  });

  it('returns playable false for Xtream legacy channel without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('pl-x', 'prov-x', 'X import', 100, 110);
    database
      .prepare(
        'INSERT INTO channels (id, playlist_id, category_id, name, stream_url) VALUES (?, ?, ?, ?, ?)',
      )
      .run('ch-x1', 'pl-x', null, 'Xtream Channel', 'xtream://channel/1');

    await register(harnessA, 'legacy-stream-xtream@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns playable false for Xtream legacy movie without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('pl-x', 'prov-x', 'X import', 100, 110);
    database
      .prepare(
        'INSERT INTO movies (id, playlist_id, category_id, name, stream_url) VALUES (?, ?, ?, ?, ?)',
      )
      .run('mv-x1', 'pl-x', null, 'Xtream Movie', 'xtream://movie/1');

    await register(harnessA, 'legacy-stream-xtream-movie@example.com');

    const response = await harnessA.call('GET', '/api/movies/mv-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns playable false for Xtream legacy episode without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO playlists (id, provider_id, name, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('pl-x', 'prov-x', 'X import', 100, 110);
    database
      .prepare(
        'INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)',
      )
      .run('cat-x', 'pl-x', 'X', 'series', 1);
    database
      .prepare(
        'INSERT INTO series (id, playlist_id, category_id, name) VALUES (?, ?, ?, ?)',
      )
      .run('se-x1', 'pl-x', 'cat-x', 'Xtream Series');
    database
      .prepare(
        'INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('ep-x1', 'se-x1', 1, 1, 'Xtream Episode', 'xtream://episode/1');

    await register(harnessA, 'legacy-stream-xtream-ep@example.com');

    const response = await harnessA.call('GET', '/api/episodes/ep-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns 404 for stream of nonexistent legacy content', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'legacy-stream-nonexistent@example.com');

    expect((await harnessA.call('GET', '/api/channels/nonexistent/stream')).status).toBe(404);
    expect((await harnessA.call('GET', '/api/movies/nonexistent/stream')).status).toBe(404);
    expect((await harnessA.call('GET', '/api/episodes/nonexistent/stream')).status).toBe(404);
  });
});
