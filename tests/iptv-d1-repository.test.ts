import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { D1ProviderRepository } from '../worker/services/iptv/d1ProviderRepository';
import type { M3uEntry, StoredProvider } from '../worker/services/iptv/types';

// Loaded via require so Vite does not try to resolve node:sqlite as a package.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

interface SqliteStatement {
  all(...params: BindValue[]): unknown[];
  get(...params: BindValue[]): unknown;
  run(...params: BindValue[]): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type BindValue = string | number | null | Uint8Array;

class SQLiteStatement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: BindValue[] = [],
  ) {}

  bind(...params: BindValue[]) {
    return new SQLiteStatement(this.db, this.sql, params);
  }

  all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

function makeDatabase() {
  const db = new DatabaseSync(':memory:');
  const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('user-1', 'owner@example.com', 'hash');
  return db;
}

function databaseAdapter(db: SqliteDatabase) {
  const adapter = {
    prepare(sql: string) {
      return new SQLiteStatement(db, sql);
    },
    batch(statements: SQLiteStatement[]) {
      db.exec('BEGIN');
      try {
        for (const statement of statements) statement.run();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return [];
    },
  };
  return adapter as unknown as ConstructorParameters<typeof D1ProviderRepository>[0];
}

function entry(index: number, kind: M3uEntry['kind']): M3uEntry {
  return {
    externalId: `id-${index}`,
    name: `Item ${index}`,
    streamUrl: `https://stream.example.com/${index}`,
    tvgId: kind === 'channel' ? `tvg-${index}` : null,
    tvgName: `Name ${index}`,
    tvgLogo: 'https://img.example.com/logo.png',
    groupTitle: 'Group One',
    country: 'US',
    language: 'English',
    channelNumber: String(index),
    kind,
  };
}

const provider: StoredProvider = {
  id: 'provider-1',
  userId: 'user-1',
  name: 'Test provider',
  type: 'm3u_url',
  serverUrl: 'https://provider.example.com/list.m3u8',
  credentialsEncrypted: null,
  credentialsKeyId: null,
  status: 'active',
  isDefault: true,
  lastRefreshAt: null,
  metadata: {},
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

describe('D1 provider repository against real migrations', () => {
  it('persists providers, catalog entries and imports without schema errors', async () => {
    const db = makeDatabase();
    const repository = new D1ProviderRepository(databaseAdapter(db));
    await repository.create(provider);

    expect((await repository.list('user-1'))[0]?.name).toBe('Test provider');
    expect((await repository.find('user-2', provider.id))).toBeNull();

    const entries = [
      entry(1, 'channel'),
      entry(2, 'movie'),
      entry(3, 'series'),
      entry(4, 'episode'),
    ];
    const keys = await repository.loadCatalogKeys('user-1', provider.id);
    let counter = 0;
    const saved = await repository.saveCatalog('user-1', provider.id, entries, keys, { newId: () => `item-${++counter}` }, 1_700_000_001);
    expect(saved).toEqual({ added: 4, updated: 0, categoriesAdded: 1 });

    const stats = {
      totalEntries: 4,
      added: 4,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      malformed: 0,
      removed: 0,
      categoriesAdded: 1,
      durationMs: 1,
    };
    await repository.saveImport('user-1', provider.id, 'checksum', stats, 1_700_000_002);

    const channel = db.prepare('SELECT name, logo_url, country, language FROM channels WHERE user_id = ?').get('user-1') as Record<string, string>;
    expect(channel.name).toBe('Item 1');
    expect(channel.logo_url).toBe('https://img.example.com/logo.png');
    expect(channel.country).toBe('US');
    expect((db.prepare('SELECT COUNT(*) AS count FROM episodes').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS count FROM playlists').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT status FROM providers WHERE id = ?').get(provider.id) as { status: string }).status).toBe('active');

    expect(await repository.setDefault('user-2', provider.id, 1_700_000_003)).toBe(false);
    expect(await repository.remove('user-2', provider.id)).toBe(false);
    expect(await repository.remove('user-1', provider.id)).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS count FROM channels').get() as { count: number }).count).toBe(0);
  });
  it('stores Xtream categories and links episodes to their series', async () => {
    const db = makeDatabase();
    const repository = new D1ProviderRepository(databaseAdapter(db));
    await repository.create(provider);
    const keys = await repository.loadCatalogKeys('user-1', provider.id);
    const entries: M3uEntry[] = [
      {
        externalId: 'xtream:series:30',
        name: 'A Show',
        streamUrl: 'xtream://series/30',
        tvgId: null,
        tvgName: null,
        tvgLogo: null,
        groupTitle: null,
        country: null,
        language: null,
        channelNumber: null,
        kind: 'series',
        categoryExternalId: 'xtream:series:3',
        categoryName: 'Shows',
        categoryType: 'series',
        posterUrl: 'https://img.test/show.png',
      },
      {
        externalId: 'xtream:episode:40',
        name: 'Pilot',
        streamUrl: 'xtream://episode/40',
        tvgId: null,
        tvgName: null,
        tvgLogo: null,
        groupTitle: null,
        country: null,
        language: null,
        channelNumber: null,
        kind: 'episode',
        seriesExternalId: 'xtream:series:30',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ];
    const saved = await repository.saveCatalog(
      'user-1',
      provider.id,
      entries,
      keys,
      { newId: () => `catalog-${crypto.randomUUID()}` },
      1_700_000_100,
      [{ externalId: 'xtream:series:3', name: 'Shows', type: 'series' }],
    );
    expect(saved).toEqual({ added: 2, updated: 0, categoriesAdded: 1 });

    const category = db.prepare("SELECT type FROM categories WHERE external_id = 'xtream:series:3'").get() as { type: string };
    expect(category.type).toBe('series');
    const episode = db.prepare('SELECT series_id, season_number FROM episodes').get() as { series_id: string | null; season_number: number };
    expect(episode.series_id).toBeTruthy();
    expect(episode.season_number).toBe(1);
  });

});
