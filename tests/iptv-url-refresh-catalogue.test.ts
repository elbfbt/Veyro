import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ContentService } from '../worker/services/content/service';
import { D1ContentRepository } from '../worker/services/content/repository';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { D1ProviderRepository } from '../worker/services/iptv/d1ProviderRepository';
import { ProviderService } from '../worker/services/iptv/providerService';
import { createHarness } from './helpers/apiHarness';
import { contentDatabaseAdapter, type SqliteDatabase } from './helpers/contentSqlite';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const USER_ID = 'user-url-refresh';
const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/**
 * A realistic provider export: live channels, VOD movies and series episodes,
 * mixing CRLF line endings, a UTF-8 BOM, quoted attributes and blank lines.
 */
const REALISTIC_PLAYLIST = [
  '\uFEFF#EXTM3U',
  '#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://img.test/bbc1.png" group-title="LIVE | UK",BBC One',
  'http://provider.example.com/live/user/pass/101.ts',
  '',
  '#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" tvg-logo="https://img.test/cnn.png" group-title="LIVE | US",CNN',
  'http://provider.example.com/live/user/pass/102.ts',
  '#EXTINF:-1 tvg-id="sky.sports" tvg-name="Sky Sports" group-title="LIVE | UK",Sky Sports',
  'http://provider.example.com/live/user/pass/103.ts',
  '#EXTINF:-1 tvg-name="Alpha Film (2020)" tvg-logo="https://img.test/alpha.jpg" group-title="VOD | Movies",Alpha Film (2020)',
  'http://provider.example.com/movie/user/pass/201.mkv',
  '#EXTINF:-1 tvg-name="Beta Film (2021)" group-title="VOD | Movies",Beta Film (2021)',
  'http://provider.example.com/movie/user/pass/202.mkv',
  '#EXTINF:-1 tvg-name="Gamma Show" tvg-logo="https://img.test/gamma.jpg" group-title="SERIES | Drama",Gamma Show',
  'http://provider.example.com/series/user/pass/301.mkv',
  '#EXTINF:-1 tvg-name="Gamma Show S01E01" group-title="SERIES | Drama",Gamma Show S01E01',
  'http://provider.example.com/series/user/pass/302.mkv',
].join('\r\n');

function makeDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((entry) => entry.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
    USER_ID,
    'url-refresh@example.com',
    'hash',
  );
  return db;
}

type BindValue = string | number | null | Uint8Array;

/** Minimal D1 adapter for the provider repository (prepare + atomic batch). */
function richProviderAdapter(db: SqliteDatabase) {
  class Statement {
    constructor(
      private readonly sql: string,
      private readonly params: BindValue[] = [],
    ) {}
    bind(...params: BindValue[]) {
      return new Statement(this.sql, params);
    }
    all<T>() {
      return { results: db.prepare(this.sql).all(...this.params) as T[] };
    }
    first<T>() {
      return (db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
    }
    run() {
      const result = db.prepare(this.sql).run(...this.params);
      return { meta: { changes: Number(result.changes) } };
    }
  }
  return {
    prepare(sql: string) {
      return new Statement(sql);
    },
    batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function setup(playlist: string, limits: { maxEntries?: number; maxBytes?: number } = {}) {
  const database = makeDatabase();
  const repository = new D1ProviderRepository(richProviderAdapter(database) as never);
  const content = new ContentService(new D1ContentRepository(contentDatabaseAdapter(database) as never));
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: {
      newId: (() => {
        const queue = ['user-url-refresh', 'session-url-refresh', 'device-url-refresh'];
        let index = 0;
        return () => queue[index++] ?? `extra-${index}`;
      })(),
    },
  });
  let counter = 0;
  const fetchPlaylist = vi.fn(async () => ({ text: playlist, bytes: playlist.length }));
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher(SECRET),
    ids: { newId: () => `provider-${++counter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist,
    ...limits,
  });
  const harness = createHarness(auth, 'https://veyro.test', providers, content);
  return { database, repository, harness, fetchPlaylist };
}

type Harness = ReturnType<typeof setup>['harness'];

async function register(harness: Harness) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email: 'url-refresh@example.com',
    password: 'long-enough-password',
    displayName: 'url-refresh',
  });
  expect(response.status).toBe(201);
}

function count(db: SqliteDatabase, table: string, providerId?: string): number {
  const row = providerId
    ? (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE provider_id = ?`).get(providerId) as { n: number })
    : (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number });
  return row.n;
}

async function createUrlProvider(harness: Harness) {
  const response = await harness.call('POST', '/api/providers', {
    name: 'URL playlist',
    type: 'm3u_url',
    url: 'https://provider.example.com/get.php?username=viewer&password=secret&type=m3u_plus',
  });
  expect(response.status).toBe(201);
  return (await response.json()).provider as { id: string; status: string; lastError: string | null };
}

describe('M3U URL provider import produces a readable catalogue', () => {
  it('classifies and saves a realistic playlist so Live, Movies and Series are populated', async () => {
    const { database, harness } = setup(REALISTIC_PLAYLIST);
    await register(harness);

    const provider = await createUrlProvider(harness);
    expect(provider.status).toBe('active');
    expect(provider.lastError).toBeNull();

    // Saved rows, grouped by type for this provider.
    expect(count(database, 'channels', provider.id)).toBe(3);
    expect(count(database, 'movies', provider.id)).toBe(2);
    expect(count(database, 'series', provider.id)).toBe(1);
    expect(count(database, 'episodes', provider.id)).toBe(1);

    // The catalogue APIs read those rows back.
    const channels = await harness.call('GET', '/api/channels');
    expect(channels.status).toBe(200);
    const channelBody = (await channels.json()) as { channels: Array<{ name: string }> };
    expect(channelBody.channels.map((channel) => channel.name).sort()).toEqual(['BBC One', 'CNN', 'Sky Sports']);

    const movies = await harness.call('GET', '/api/movies');
    const movieBody = (await movies.json()) as { movies: Array<{ title: string }> };
    expect(movieBody.movies.map((movie) => movie.title).sort()).toEqual(['Alpha Film (2020)', 'Beta Film (2021)']);

    const series = await harness.call('GET', '/api/series');
    const seriesBody = (await series.json()) as { series: Array<{ title: string }> };
    expect(seriesBody.series.map((item) => item.title)).toEqual(['Gamma Show']);

    // An explicit refresh re-imports the same playlist idempotently.
    const refreshed = await harness.call('POST', `/api/providers/${provider.id}/refresh`);
    expect(refreshed.status).toBe(200);
    const stats = (await refreshed.json()) as { totalEntries: number; added: number; updated: number };
    expect(stats.totalEntries).toBe(7);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(7);
    expect(count(database, 'channels', provider.id)).toBe(3);
    expect(count(database, 'movies', provider.id)).toBe(2);
    expect(count(database, 'series', provider.id)).toBe(1);
  });

  it('imports a playlist larger than the previous 20,000-entry URL cap', async () => {
    const entries = 20_050;
    const lines = ['#EXTM3U'];
    for (let index = 0; index < entries; index += 1) {
      lines.push(`#EXTINF:-1 tvg-id="ch${index}" group-title="News",Channel ${index}`);
      lines.push(`http://provider.example.com/live/user/pass/${index}.ts`);
    }
    const { database, harness } = setup(lines.join('\n'));
    await register(harness);

    const provider = await createUrlProvider(harness);
    expect(provider.status).toBe('active');
    expect(count(database, 'channels', provider.id)).toBe(entries);
  }, 60_000);
});

describe('a URL import that saves nothing is never reported as success', () => {
  it('rejects an upstream playlist with no importable entries instead of marking it active', async () => {
    // A provider stub / blocked response: a valid header with an empty grid.
    const { database, harness } = setup('#EXTM3U\r\n');
    await register(harness);

    const provider = await createUrlProvider(harness);
    // The provider is created, but the import is reported truthfully.
    expect(provider.status).toBe('error');
    expect(provider.lastError).toContain('no importable entries');

    expect(count(database, 'channels', provider.id)).toBe(0);
    expect(count(database, 'movies', provider.id)).toBe(0);
    expect(count(database, 'series', provider.id)).toBe(0);
    expect(count(database, 'playlists', provider.id)).toBe(0);
    expect(
      (database.prepare('SELECT status FROM providers WHERE id = ?').get(provider.id) as { status: string }).status,
    ).toBe('error');

    // An explicit refresh fails loudly with a safe message rather than 200.
    const refreshed = await harness.call('POST', `/api/providers/${provider.id}/refresh`);
    expect(refreshed.status).toBe(422);
    const body = (await refreshed.json()) as { error: string; message: string };
    expect(body.error).toBe('empty_playlist');
    expect(body.message).not.toContain('provider.example.com');

    expect(count(database, 'channels')).toBe(0);
    const listing = await harness.call('GET', '/api/providers');
    const listed = ((await listing.json()) as { providers: Array<{ id: string; status: string }> }).providers.find(
      (item) => item.id === provider.id,
    );
    expect(listed?.status).toBe('error');
  });

  it('keeps a provider retryable when an over-limit playlist fails the import', async () => {
    const lines = ['#EXTM3U'];
    for (let index = 0; index < 12; index += 1) {
      lines.push(`#EXTINF:-1 tvg-id="c${index}",Channel ${index}`);
      lines.push(`http://provider.example.com/live/${index}.ts`);
    }
    // Simulate a playlist above the configured entry ceiling.
    const { database, harness } = setup(lines.join('\n'), { maxEntries: 5 });
    await register(harness);

    const provider = await createUrlProvider(harness);
    expect(provider.status).toBe('error');
    expect(count(database, 'channels', provider.id)).toBe(0);

    const refreshed = await harness.call('POST', `/api/providers/${provider.id}/refresh`);
    expect(refreshed.status).toBe(413);
    expect(((await refreshed.json()) as { error: string }).error).toBe('playlist_too_large');
  });

  it('never flips a provider to active when the import wrote no catalogue rows', async () => {
    const { database, repository } = setup(REALISTIC_PLAYLIST);
    const provider = {
      id: 'provider-empty',
      userId: USER_ID,
      name: 'Empty import',
      type: 'm3u_url' as const,
      serverUrl: 'https://provider.example.com/list.m3u',
      credentialsEncrypted: null,
      credentialsKeyId: null,
      status: 'refreshing' as const,
      isDefault: false,
      lastRefreshAt: null,
      metadata: {},
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    };
    await repository.create(provider);
    await repository.saveImport(
      USER_ID,
      provider.id,
      'checksum',
      {
        totalEntries: 0,
        added: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        malformed: 0,
        removed: 0,
        categoriesAdded: 0,
        durationMs: 1,
      },
      1_700_000_001,
    );

    const row = database.prepare('SELECT status, metadata FROM providers WHERE id = ?').get(provider.id) as {
      status: string;
      metadata: string;
    };
    expect(row.status).toBe('error');
    expect(row.metadata).toContain('No catalogue entries were saved');
  });
});
