import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ContentService } from '../worker/services/content/service';
import { D1ContentRepository } from '../worker/services/content/repository';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';
import { contentDatabaseAdapter, makeContentDatabase, type SqliteDatabase } from './helpers/contentSqlite';

const USER_A = 'user-a';
const USER_B = 'user-b';

function seed(db: SqliteDatabase) {
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-a', USER_A, 'Provider A', 'm3u_url', 1);
  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-a2', USER_A, 'Provider A Two', 'm3u_file', 0);
  run('INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)', 'prov-b', USER_B, 'Provider B', 'm3u_url', 1);

  run('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)', 'cat-a-news', USER_A, 'prov-a', 'news', 'News', 'channel');
  run('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)', 'cat-a-sport', USER_A, 'prov-a', 'sport', 'Sports', 'channel');
  run('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)', 'cat-a-movies', USER_A, 'prov-a', 'movies', 'Movies', 'movie');
  run('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)', 'cat-a-series', USER_A, 'prov-a', 'series', 'Drama', 'series');
  run('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)', 'cat-b-news', USER_B, 'prov-b', 'news', 'News', 'channel');

  run(
    'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, tvg_name, logo_url, stream_url, channel_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ch-a1', USER_A, 'prov-a', 'cat-a-news', 'ext-a1', 'Alpha News', 'Alpha TV', 'javascript:alert(1)', 'https://stream.test/a1', '101', 100, 100,
  );
  run(
    'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, tvg_name, stream_url, channel_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ch-a2', USER_A, 'prov-a', 'cat-a-sport', 'ext-a2', 'Beta Sports', 'Beta TV', 'https://stream.test/a2', '102', 200, 200,
  );
  run(
    'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ch-a3', USER_A, 'prov-a2', null, 'ext-a3', 'Gamma Kids', 'https://stream.test/a3', 300, 300,
  );
  run(
    'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ch-b1', USER_B, 'prov-b', 'cat-b-news', 'ext-b1', 'Secret Channel', 'https://stream.test/b1', 400, 400,
  );

  run(
    'INSERT INTO movies (id, user_id, provider_id, category_id, external_id, title, description, poster_url, stream_url, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'mv-a1', USER_A, 'prov-a', 'cat-a-movies', 'ext-m1', 'Alpha Film', 'A film', 'https://img.test/alpha.png', 'https://stream.test/m1', 2021, 100, 100,
  );
  run(
    'INSERT INTO movies (id, user_id, provider_id, external_id, title, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'mv-b1', USER_B, 'prov-b', 'ext-m2', 'Secret Film', 'https://stream.test/m2', 200, 200,
  );

  run(
    'INSERT INTO series (id, user_id, provider_id, category_id, external_id, title, description, poster_url, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'se-a1', USER_A, 'prov-a', 'cat-a-series', 'ext-s1', 'Alpha Show', 'A series', 'https://img.test/show.png', 2020, 100, 100,
  );
  run(
    'INSERT INTO series (id, user_id, provider_id, external_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'se-b1', USER_B, 'prov-b', 'ext-s2', 'Secret Show', 200, 200,
  );
  run(
    'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ep-a2', USER_A, 'prov-a', 'se-a1', 'ext-e2', 'Second', 'xtream://episode/2', 1, 2, 200, 200,
  );
  run(
    'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ep-a1', USER_A, 'prov-a', 'se-a1', 'ext-e1', 'First', 'xtream://episode/1', 1, 1, 100, 100,
  );
  run(
    'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ep-a3', USER_A, 'prov-a', 'se-a1', 'ext-e3', 'Finale', 'xtream://episode/3', 2, 1, 300, 300,
  );
  run(
    'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ep-b1', USER_B, 'prov-b', 'se-b1', 'ext-e4', 'Secret Episode', 'placeholder', 200, 200,
  );
}

function setup() {
  const database = makeContentDatabase([USER_A, USER_B]);
  seed(database);
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
  const harnessA = createHarness(auth, 'https://veyro.test', undefined, content);
  const harnessB = createHarness(auth, 'https://veyro.test', undefined, content);
  return { content, harnessA, harnessB, database };
}

async function register(harness: ReturnType<typeof setup>['harnessA'], email: string) {
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

type ChannelsBody = PaginationBody & { channels: Array<{ id: string; logoUrl: string | null }> };
type MoviesBody = PaginationBody & { movies: Array<{ id: string; year: number | null }> };
type SeriesBody = PaginationBody & { series: Array<{ id: string }> };
type CategoriesBody = PaginationBody & { categories: Array<{ id: string; itemCount: number }> };
type EpisodesBody = PaginationBody & { episodes: Array<{ id: string }> };

describe('content browsing API', () => {
  it('requires authentication for all content endpoints', async () => {
    const { harnessA } = setup();
    for (const path of ['/api/channels', '/api/movies', '/api/series', '/api/categories']) {
      expect((await harnessA.call('GET', path, undefined, { cookie: false })).status).toBe(401);
    }
  });

  it('lists channels with provider, category, search, sort and pagination filters', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'content-a@example.com');

    const all = await harnessA.call('GET', '/api/channels');
    expect(all.status).toBe(200);
    const body = (await all.json()) as ChannelsBody;
    expect(body.channels.map((channel) => channel.id)).toEqual(['ch-a1', 'ch-a2', 'ch-a3']);
    expect(body.channels[0]?.logoUrl).toBeNull();

    const paged = await harnessA.call('GET', '/api/channels?limit=1&page=2&sort=name');
    const pagedBody = (await paged.json()) as ChannelsBody;
    expect(pagedBody.channels).toHaveLength(1);
    expect(pagedBody.pagination).toMatchObject({ page: 2, limit: 1, total: 3, hasMore: true });

    const providerFiltered = await harnessA.call('GET', '/api/channels?provider=prov-a2');
    expect(((await providerFiltered.json()) as ChannelsBody).channels.map((item) => item.id)).toEqual(['ch-a3']);

    const categoryFiltered = await harnessA.call('GET', '/api/channels?category=cat-a-sport');
    expect(((await categoryFiltered.json()) as ChannelsBody).channels.map((item) => item.id)).toEqual(['ch-a2']);

    const searched = await harnessA.call('GET', '/api/channels?q=beta');
    expect(((await searched.json()) as ChannelsBody).channels.map((item) => item.id)).toEqual(['ch-a2']);
    const byCategorySearch = await harnessA.call('GET', '/api/channels?q=sports');
    expect(((await byCategorySearch.json()) as ChannelsBody).channels.map((item) => item.id)).toEqual(['ch-a2']);

    expect((await harnessA.call('GET', '/api/channels?limit=1000')).status).toBe(400);
    expect((await harnessA.call('GET', '/api/channels?page=0')).status).toBe(400);
  });

  it('lists movies and series with safe metadata and bounded responses', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'content-movies@example.com');

    const movies = await harnessA.call('GET', '/api/movies?q=alpha&sort=year&limit=12');
    const movieBody = (await movies.json()) as MoviesBody;
    expect(movieBody.movies.map((item) => item.id)).toEqual(['mv-a1']);
    expect(movieBody.movies[0]?.year).toBe(2021);

    const series = await harnessA.call('GET', '/api/series?category=cat-a-series');
    const seriesBody = (await series.json()) as SeriesBody;
    expect(seriesBody.series.map((item) => item.id)).toEqual(['se-a1']);
  });

  it('filters categories by type and provider with bounded pagination', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'content-categories@example.com');

    const categories = await harnessA.call('GET', '/api/categories?type=channel&provider=prov-a');
    const body = (await categories.json()) as CategoriesBody;
    expect(body.categories.map((item) => item.id)).toEqual(['cat-a-news', 'cat-a-sport']);
    expect(body.categories[0]?.itemCount).toBe(1);
    expect((await harnessA.call('GET', '/api/categories?type=episode')).status).toBe(400);
    expect((await harnessA.call('GET', '/api/categories?limit=5000')).status).toBe(400);
  });

  it('returns series details and episodes ordered by season and episode number', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'content-series@example.com');

    const detail = await harnessA.call('GET', '/api/series/se-a1');
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { series: { title: string } }).series.title).toBe('Alpha Show');

    const episodes = await harnessA.call('GET', '/api/series/se-a1/episodes');
    const body = (await episodes.json()) as EpisodesBody;
    expect(body.episodes.map((item) => item.id)).toEqual(['ep-a1', 'ep-a2', 'ep-a3']);
    expect(body.pagination).toMatchObject({ total: 3, page: 1, limit: 50 });

    const episode = await harnessA.call('GET', '/api/episodes/ep-a1');
    expect(((await episode.json()) as { episode: { title: string } }).episode.title).toBe('First');
  });

  it('blocks IDOR, provider spoofing and cross-user category filters', async () => {
    const { harnessA, harnessB } = setup();
    await register(harnessA, 'content-owner@example.com');
    await register(harnessB, 'content-intruder@example.com');

    for (const path of [
      '/api/channels/ch-a1',
      '/api/movies/mv-a1',
      '/api/series/se-a1',
      '/api/series/se-a1/episodes',
      '/api/episodes/ep-a1',
      '/api/channels?provider=prov-a',
      '/api/channels?category=cat-a-news',
      '/api/movies?provider=prov-a',
      '/api/series?provider=prov-a',
      '/api/categories?provider=prov-a',
    ]) {
      const response = await harnessB.call('GET', path);
      expect(response.status, path).toBe(404);
    }

    const own = await harnessB.call('GET', '/api/channels');
    const body = (await own.json()) as ChannelsBody;
    expect(body.channels.map((item) => item.id)).toEqual(['ch-b1']);
  });

  it('never allows raw sort input to reach SQL', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'content-sort@example.com');
    const response = await harnessA.call('GET', '/api/channels?sort=name%3B%20DROP%20TABLE%20channels');
    expect(response.status).toBe(200);
    const body = (await response.json()) as ChannelsBody;
    expect(body.channels).toHaveLength(3);
  });
});

describe('stream resolution API (rich schema)', () => {
  it('resolves M3U channel stream for owner', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'stream-channel@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-a1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/a1' });
  });

  it('resolves M3U movie stream for owner', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'stream-movie@example.com');

    const response = await harnessA.call('GET', '/api/movies/mv-a1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/m1' });
  });

  it('resolves M3U episode stream for owner', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'ep-stream-m3u',
        USER_A,
        'prov-a',
        'se-a1',
        'ext-e-stream',
        'Stream Episode',
        'https://stream.test/ep-stream',
        1,
        1,
        100,
        100,
      );

    await register(harnessA, 'stream-episode@example.com');

    const response = await harnessA.call('GET', '/api/episodes/ep-stream-m3u/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/ep-stream' });
  });

  it('resolves m3u_file channel stream for owner', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'stream-file@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-a3/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: true, streamUrl: 'https://stream.test/a3' });
  });

  it('rejects unauthenticated stream requests', async () => {
    const { harnessA } = setup();
    for (const path of ['/api/channels/ch-a1/stream', '/api/movies/mv-a1/stream', '/api/episodes/ep-a1/stream']) {
      expect((await harnessA.call('GET', path, undefined, { cookie: false })).status).toBe(401);
    }
  });

  it('prevents cross-user stream resolution', async () => {
    const { harnessA, harnessB } = setup();
    await register(harnessA, 'stream-owner@example.com');
    await register(harnessB, 'stream-intruder@example.com');

    for (const path of ['/api/channels/ch-a1/stream', '/api/movies/mv-a1/stream', '/api/episodes/ep-a1/stream']) {
      expect((await harnessB.call('GET', path)).status).toBe(404);
    }
  });

  it('keeps stream_url out of normal catalogue/detail responses', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'stream-nostream@example.com');

    const channelBody = await (await harnessA.call('GET', '/api/channels/ch-a1')).json();
    expect(channelBody.channel).toMatchObject({ id: 'ch-a1' });
    expect(channelBody.channel).not.toHaveProperty('streamUrl');

    const movieBody = await (await harnessA.call('GET', '/api/movies/mv-a1')).json();
    expect(movieBody.movie).not.toHaveProperty('streamUrl');

    const episodeBody = await (await harnessA.call('GET', '/api/episodes/ep-a1')).json();
    expect(episodeBody.episode).not.toHaveProperty('streamUrl');
  });

  it('returns playable false for Xtream channel without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('ch-x1', USER_A, 'prov-x', null, 'ext-x1', 'Xtream Channel', 'xtream://channel/1', 100, 100);

    await register(harnessA, 'stream-xtream@example.com');

    const response = await harnessA.call('GET', '/api/channels/ch-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns playable false for Xtream movie without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO movies (id, user_id, provider_id, category_id, external_id, title, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('mv-x1', USER_A, 'prov-x', null, 'ext-x1', 'Xtream Movie', 'xtream://movie/1', 100, 100);

    await register(harnessA, 'stream-xtream-movie@example.com');

    const response = await harnessA.call('GET', '/api/movies/mv-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns playable false for Xtream episode without streamUrl', async () => {
    const { database, harnessA } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO series (id, user_id, provider_id, category_id, external_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('se-x1', USER_A, 'prov-x', null, 'ext-x1', 'Xtream Series', 100, 100);
    database
      .prepare(
        'INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'ep-x1',
        USER_A,
        'prov-x',
        'se-x1',
        'ext-x1',
        'Xtream Episode',
        'xtream://episode/1',
        1,
        1,
        100,
        100,
      );

    await register(harnessA, 'stream-xtream-ep@example.com');

    const response = await harnessA.call('GET', '/api/episodes/ep-x1/stream');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stream).toEqual({ playable: false, reason: 'xtream_web_playback_unsupported' });
    expect(body.stream.streamUrl).toBeUndefined();
  });

  it('returns 404 for stream of nonexistent content', async () => {
    const { harnessA } = setup();
    await register(harnessA, 'stream-nonexistent@example.com');

    expect((await harnessA.call('GET', '/api/channels/nonexistent/stream')).status).toBe(404);
    expect((await harnessA.call('GET', '/api/movies/nonexistent/stream')).status).toBe(404);
    expect((await harnessA.call('GET', '/api/episodes/nonexistent/stream')).status).toBe(404);
  });

  it('returns 404 when intruder requests another user Xtream stream', async () => {
    const { database, harnessA, harnessB } = setup();
    database
      .prepare(
        'INSERT INTO providers (id, user_id, name, type, is_default) VALUES (?, ?, ?, ?, ?)',
      )
      .run('prov-x', USER_A, 'Provider X', 'xtream', 0);
    database
      .prepare(
        'INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('ch-x1', USER_A, 'prov-x', null, 'ext-x1', 'Xtream Channel', 'xtream://channel/1', 100, 100);

    await register(harnessA, 'stream-xtream-owner@example.com');
    await register(harnessB, 'stream-xtream-intruder@example.com');

    expect((await harnessB.call('GET', '/api/channels/ch-x1/stream')).status).toBe(404);
  });
});
