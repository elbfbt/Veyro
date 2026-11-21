import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ContentService } from '../worker/services/content/service';
import { D1ContentRepository } from '../worker/services/content/repository';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import {
  D1ProviderRepository,
  type ProviderRepositoryDiagnostic,
} from '../worker/services/iptv/d1ProviderRepository';
import { ProviderService } from '../worker/services/iptv/providerService';
import { createHarness } from './helpers/apiHarness';
import {
  contentDatabaseAdapter,
  legacyProviderDatabaseAdapter,
  makeContentDatabase,
  makeLegacyContentDatabaseWithForeignKeys,
  type SqliteDatabase,
} from './helpers/contentSqlite';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';

const USER_ID = 'user-fk';

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="https://img.test/cnn.png" group-title="Cooking & Recipes",CNN Cooking
https://stream.test/cnn.m3u8
#EXTINF:-1 tvg-id="bbc" tvg-name="BBC Food" tvg-logo="https://img.test/bbc.png" group-title="Cooking & Recipes",BBC Food
https://stream.test/bbc.m3u8
#EXTINF:-1 tvg-id="mv1" group-title="Movies",Alpha Film
https://stream.test/alpha.mp4
#EXTINF:-1 tvg-id="se1" group-title="Series",Alpha Show
https://stream.test/show.m3u8
#EXTINF:-1 tvg-id="ep1" group-title="Series",Alpha Show S01E01
https://stream.test/episode1.mp4
`;

type Diagnostic = ProviderRepositoryDiagnostic;

function makeAuth() {
  return new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: {
      newId: (() => {
        const queue = ['user-fk', 'session-fk', 'device-fk'];
        let index = 0;
        return () => queue[index++] ?? `extra-${index}`;
      })(),
    },
  });
}

function setup(options: { failOnProviderTouch?: boolean } = {}) {
  const database = makeLegacyContentDatabaseWithForeignKeys([USER_ID]);
  const diagnostics: Diagnostic[] = [];
  const sql: string[] = [];
  const baseAdapter = legacyProviderDatabaseAdapter(database, (statement) => sql.push(statement));
  const adapter = options.failOnProviderTouch
    ? {
        ...baseAdapter,
        async batch(statements: Array<{ run(): { changes: number | bigint }; sql?: string }>) {
          if (statements.some((statement) => statement.sql?.includes('UPDATE providers SET updated_at'))) {
            throw new Error('FOREIGN KEY constraint failed');
          }
          return baseAdapter.batch(statements);
        },
      }
    : baseAdapter;

  const repository = new D1ProviderRepository(adapter as never, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  let providerCounter = 0;
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'),
    ids: { newId: () => `provider-${++providerCounter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist: vi.fn(async () => ({ text: M3U, bytes: M3U.length })),
  });
  const content = new ContentService(new D1ContentRepository(contentDatabaseAdapter(database) as never));
  const harness = createHarness(makeAuth(), 'https://veyro.test', providers, content);
  return { database, diagnostics, sql, harness };
}

async function register(harness: ReturnType<typeof setup>['harness']) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email: 'legacy-fk@example.com',
    password: 'long-enough-password',
    displayName: 'legacy-fk',
  });
  expect(response.status).toBe(201);
}

function uploadForm() {
  const form = new FormData();
  form.append('name', 'cooking');
  form.append('file', new Blob([M3U]), 'cooking.m3u');
  return form;
}

function rows(db: SqliteDatabase, sql: string, ...params: (string | number | null)[]): Array<Record<string, unknown>> {
  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

describe('complete import against exact legacy production schema with D1 foreign keys', () => {
  it('documents the exact SQL and exception produced by REPLACE on a parent row', () => {
    const db = makeLegacyContentDatabaseWithForeignKeys([USER_ID], ' ON DELETE RESTRICT');
    db.prepare(
      `INSERT INTO providers
       (id, user_id, name, type, server_url, username_encrypted, password_encrypted,
        created_at, updated_at, is_default)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run('provider-1', USER_ID, 'cooking', 'm3u_file', 1, 1, 1);
    db.prepare(
      'INSERT INTO playlists (id, provider_id, name, source_url, imported_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
    ).run('playlist-1', 'provider-1', 'Imported playlist', 1, 1);
    db.prepare('INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)').run(
      'category-1',
      'playlist-1',
      'Cooking',
      'channel',
      1,
    );
    db.prepare(
      `INSERT INTO channels
       (id, playlist_id, category_id, name, stream_url, logo_url, tvg_id, tvg_name, is_live)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    ).run('channel-1', 'playlist-1', 'category-1', 'CNN', 'https://stream.test/cnn', 1);

    // This is the statement the previous import used in saveImport after the
    // catalogue rows had already been inserted.
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO playlists (id, provider_id, name, source_url, imported_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('playlist-1', 'provider-1', 'Imported playlist', null, 2, 2),
    ).toThrow('FOREIGN KEY constraint failed');
  });

  it('returns HTTP 200, keeps the catalogue, and selects the legacy schema path', async () => {
    const { database, diagnostics, sql, harness } = setup();
    await register(harness);

    const response = await harness.call('POST', '/api/providers/import', undefined, {
      rawBody: uploadForm(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      imported: boolean;
      provider: { id: string; xtreamUsername: string | null; isDefault: boolean };
    };
    expect(body.imported).toBe(true);
    expect(body.provider.xtreamUsername).toBeNull();
    expect(body.provider.isDefault).toBe(true);
    expect(diagnostics).toEqual([]);

    // No credentials or Xtream fields are needed for an M3U file import.
    const provider = rows(database, 'SELECT * FROM providers WHERE id = ?', body.provider.id);
    expect(provider).toMatchObject([{ user_id: USER_ID, type: 'm3u_file', username_encrypted: null, password_encrypted: null }]);

    const playlist = rows(database, 'SELECT * FROM playlists WHERE provider_id = ?', body.provider.id);
    expect(playlist).toHaveLength(1);
    const playlistId = playlist[0]?.id as string;

    // With INSERT OR REPLACE these rows were deleted by the later playlist replace.
    expect(rows(database, 'SELECT * FROM channels WHERE playlist_id = ?', playlistId)).toHaveLength(2);
    expect(rows(database, 'SELECT * FROM movies WHERE playlist_id = ?', playlistId)).toHaveLength(1);
    expect(rows(database, 'SELECT * FROM series WHERE playlist_id = ?', playlistId)).toHaveLength(1);
    expect(rows(database, 'SELECT * FROM episodes')).toHaveLength(1);
    expect(rows(database, 'SELECT * FROM categories WHERE playlist_id = ?', playlistId)).toHaveLength(3);

    // The legacy path is chosen from the exact production columns, not guessed.
    expect(sql.filter((statement) => statement.includes('PRAGMA table_info(providers)'))).toHaveLength(1);
    expect(sql.some((statement) => statement.includes('username_encrypted'))).toBe(true);
    expect(sql.some((statement) => statement.includes('INSERT OR REPLACE'))).toBe(false);
    expect(sql.some((statement) => statement.includes('ON CONFLICT(id) DO UPDATE'))).toBe(true);
  });

  it('captures the underlying database exception before the generic HTTP 500 response', async () => {
    const { diagnostics, harness } = setup({ failOnProviderTouch: true });
    await register(harness);

    const response = await harness.call('POST', '/api/providers/import', undefined, {
      rawBody: uploadForm(),
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'internal_error', message: 'The request could not be completed.' });
    expect(JSON.stringify(body)).not.toContain('FOREIGN KEY');

    expect(diagnostics).toEqual([
      { operation: 'import.playlist-upsert', message: 'FOREIGN KEY constraint failed' },
    ]);
  });

  it('keeps the schema cache isolated per D1 binding', async () => {
    const legacySql: string[] = [];
    const richSql: string[] = [];
    const legacy = makeLegacyContentDatabaseWithForeignKeys([USER_ID]);
    const rich = makeContentDatabase([USER_ID]);
    const legacyRepository = new D1ProviderRepository(
      legacyProviderDatabaseAdapter(legacy, (statement) => legacySql.push(statement)) as never,
    );
    const richRepository = new D1ProviderRepository(
      legacyProviderDatabaseAdapter(rich, (statement) => richSql.push(statement)) as never,
    );

    await Promise.all([legacyRepository.list(USER_ID), richRepository.list(USER_ID)]);

    expect(legacySql.filter((statement) => statement.includes('PRAGMA table_info(providers)'))).toHaveLength(1);
    expect(richSql.filter((statement) => statement.includes('PRAGMA table_info(providers)'))).toHaveLength(1);

    await Promise.all([legacyRepository.find(USER_ID, 'missing'), richRepository.find(USER_ID, 'missing')]);
    expect(legacySql.filter((statement) => statement.includes('PRAGMA table_info(providers)'))).toHaveLength(1);
    expect(richSql.filter((statement) => statement.includes('PRAGMA table_info(providers)'))).toHaveLength(1);
  });
});
