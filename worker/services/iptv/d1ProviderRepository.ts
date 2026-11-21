import { toBase64Url } from '../auth/tokens';
import type { CatalogCategory, ImportJob, ImportJobStatus, ImportStats, M3uEntry, ProviderStatus, ProviderType, StoredProvider } from './types';

// Minimal structural subset of D1 so this module also typechecks in the SPA config.
type BindValue = string | number | boolean | null | ArrayBuffer | Uint8Array;

interface ProviderStatement {
  bind(...values: BindValue[]): ProviderStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}

interface ProviderDatabase {
  prepare(sql: string): ProviderStatement;
  batch(statements: ProviderStatement[]): Promise<unknown[]>;
}

interface ProviderRow {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  server_url: string | null;
  credentials_encrypted: string | null;
  credentials_key_id: string | null;
  status: ProviderStatus;
  is_default: number;
  last_refreshed_at: number | null;
  metadata: string;
  created_at: number;
  updated_at: number;
}

/** Production D1 predates the richer provider/catalogue schema. */
interface LegacyProviderRow {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  server_url: string | null;
  username_encrypted: string | null;
  password_encrypted: string | null;
  created_at: number | null;
  updated_at: number | null;
  is_default: number;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapProvider(row: ProviderRow): StoredProvider {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    serverUrl: row.server_url,
    credentialsEncrypted: row.credentials_encrypted,
    credentialsKeyId: row.credentials_key_id,
    status: row.status,
    isDefault: row.is_default === 1,
    lastRefreshAt: row.last_refreshed_at,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Legacy providers store the key id and combined credential ciphertext in the
 * two available encrypted columns. Status/metadata have no column, so the
 * stable API view uses the provider's last update time and empty metadata.
 */
function mapLegacyProvider(row: LegacyProviderRow): StoredProvider {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    serverUrl: row.server_url,
    credentialsEncrypted: row.password_encrypted,
    credentialsKeyId: row.username_encrypted,
    status: 'active',
    isDefault: row.is_default === 1,
    lastRefreshAt: row.updated_at ?? row.created_at ?? null,
    metadata: {},
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

const CHUNK_SIZE = 400;
type SchemaMode = 'rich' | 'legacy';

/**
 * Conservative upserts. SQLite's INSERT OR REPLACE deletes the conflicting row
 * first, which violates (or cascades through) D1 foreign keys once catalogue
 * children exist. ON CONFLICT DO UPDATE keeps the original row identity.
 */
const LEGACY_PLAYLIST_UPSERT = `
  INSERT INTO playlists (id, provider_id, name, source_url, imported_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    provider_id = excluded.provider_id,
    name = excluded.name,
    source_url = excluded.source_url,
    imported_at = excluded.imported_at,
    updated_at = excluded.updated_at
`;
const LEGACY_CATEGORY_UPSERT = `
  INSERT INTO categories (id, playlist_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    playlist_id = excluded.playlist_id,
    name = excluded.name,
    type = excluded.type,
    sort_order = excluded.sort_order
`;
const LEGACY_SERIES_UPSERT = `
  INSERT INTO series (id, playlist_id, category_id, name, logo_url, year, description) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    playlist_id = excluded.playlist_id,
    category_id = excluded.category_id,
    name = excluded.name,
    logo_url = excluded.logo_url,
    year = excluded.year,
    description = excluded.description
`;
const LEGACY_CHANNEL_UPSERT = `
  INSERT INTO channels (id, playlist_id, category_id, name, stream_url, logo_url, tvg_id, tvg_name, is_live)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    playlist_id = excluded.playlist_id,
    category_id = excluded.category_id,
    name = excluded.name,
    stream_url = excluded.stream_url,
    logo_url = excluded.logo_url,
    tvg_id = excluded.tvg_id,
    tvg_name = excluded.tvg_name,
    is_live = excluded.is_live
`;
const LEGACY_MOVIE_UPSERT = `
  INSERT INTO movies (id, playlist_id, category_id, name, stream_url, logo_url, year, duration, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    playlist_id = excluded.playlist_id,
    category_id = excluded.category_id,
    name = excluded.name,
    stream_url = excluded.stream_url,
    logo_url = excluded.logo_url,
    year = excluded.year,
    duration = excluded.duration,
    description = excluded.description
`;
const LEGACY_EPISODE_UPSERT = `
  INSERT INTO episodes (id, series_id, season_number, episode_number, name, stream_url, duration, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    series_id = excluded.series_id,
    season_number = excluded.season_number,
    episode_number = excluded.episode_number,
    name = excluded.name,
    stream_url = excluded.stream_url,
    duration = excluded.duration,
    description = excluded.description
`;

export interface ProviderRepositoryDiagnostic {
  /** Stable operation label; never contains SQL parameters or user content. */
  operation: string;
  /** Error message only. Callers decide whether to log it in a safe context. */
  message: string;
}

export interface D1ProviderRepositoryOptions {
  /** Test/debug hook. Production code does not pass this, so nothing is logged. */
  onDiagnostic?: (diagnostic: ProviderRepositoryDiagnostic) => void;
}

// Cache schema detection per D1 binding; Worker builds a repository per request.
const schemaCache = new WeakMap<object, Promise<SchemaMode>>();

/**
 * Legacy content tables have no external_id column. Stable IDs derived from
 * provider + kind + source ID give us idempotent re-imports without adding
 * columns or trusting client-supplied IDs.
 */
async function stableId(prefix: 'pl' | 'cat' | 'ch' | 'mv' | 'se' | 'ep', providerId: string, externalId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${prefix}:${providerId}:${externalId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const suffix = toBase64Url(digest).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  return `${prefix}_${suffix}`;
}

function legacyPlaylistId(providerId: string): Promise<string> {
  return stableId('pl', providerId, 'imported');
}

export type CatalogKeyRow = { external_id: string; id: string; type?: 'channel' | 'movie' | 'series' };
export type CatalogKeys = {
  channels: Map<string, string>;
  movies: Map<string, string>;
  series: Map<string, string>;
  episodes: Map<string, string>;
  categories: Map<string, string>;
};

const EMPTY_KEYS = (): CatalogKeys => ({
  channels: new Map(),
  movies: new Map(),
  series: new Map(),
  episodes: new Map(),
  categories: new Map(),
});

export class D1ProviderRepository {
  constructor(
    private readonly db: ProviderDatabase,
    private readonly options: D1ProviderRepositoryOptions = {},
  ) {}

  private reportDiagnostic(operation: string, error: unknown): void {
    this.options.onDiagnostic?.({
      operation,
      message: error instanceof Error ? error.message : 'Unknown database error',
    });
  }

  private async monitoredRun(operation: string, statement: ProviderStatement) {
    try {
      return await statement.run();
    } catch (error) {
      this.reportDiagnostic(operation, error);
      throw error;
    }
  }

  private async monitoredBatch(operation: string, statements: ProviderStatement[]): Promise<unknown[]> {
    try {
      return await this.db.batch(statements);
    } catch (error) {
      this.reportDiagnostic(operation, error);
      throw error;
    }
  }

  private async schemaMode(): Promise<SchemaMode> {
    const key = this.db as object;
    let detected = schemaCache.get(key);
    if (!detected) {
      detected = (async () => {
        const result = await this.db.prepare('PRAGMA table_info(providers)').all<{ name: string }>();
        const columns = new Set((result.results ?? []).map((row) => row.name));
        return columns.has('credentials_encrypted') ? 'rich' : 'legacy';
      })();
      schemaCache.set(key, detected);
    }
    return detected;
  }

  async list(userId: string): Promise<StoredProvider[]> {
    if ((await this.schemaMode()) === 'legacy') {
      const result = await this.db
        .prepare('SELECT * FROM providers WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
        .bind(userId)
        .all<LegacyProviderRow>();
      return (result.results ?? []).map(mapLegacyProvider);
    }
    const result = await this.db
      .prepare('SELECT * FROM providers WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .bind(userId)
      .all<ProviderRow>();
    return (result.results ?? []).map(mapProvider);
  }

  async find(userId: string, id: string): Promise<StoredProvider | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const row = await this.db
        .prepare('SELECT * FROM providers WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .first<LegacyProviderRow>();
      return row ? mapLegacyProvider(row) : null;
    }
    const row = await this.db
      .prepare('SELECT * FROM providers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<ProviderRow>();
    return row ? mapProvider(row) : null;
  }

  async create(provider: StoredProvider): Promise<void> {
    if ((await this.schemaMode()) === 'legacy') {
      const insert = this.db
        .prepare(
          `INSERT INTO providers
             (id, user_id, name, type, server_url, username_encrypted, password_encrypted,
              created_at, updated_at, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          provider.id,
          provider.userId,
          provider.name,
          provider.type,
          provider.serverUrl,
          provider.credentialsKeyId,
          provider.credentialsEncrypted,
          provider.createdAt,
          provider.updatedAt,
          provider.isDefault ? 1 : 0,
        );
      if (!provider.isDefault) {
        await this.monitoredRun('provider.create', insert);
        return;
      }
      await this.monitoredBatch('provider.create-default', [
        this.db.prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE user_id = ?').bind(provider.updatedAt, provider.userId),
        insert,
      ]);
      return;
    }

    const insert = this.db
      .prepare(
        `INSERT INTO providers
           (id, user_id, name, type, server_url, credentials_encrypted, credentials_key_id,
            is_default, status, last_refreshed_at, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        provider.id,
        provider.userId,
        provider.name,
        provider.type,
        provider.serverUrl,
        provider.credentialsEncrypted,
        provider.credentialsKeyId,
        provider.isDefault ? 1 : 0,
        provider.status,
        provider.lastRefreshAt,
        JSON.stringify(provider.metadata),
        provider.createdAt,
        provider.updatedAt,
      );
    if (!provider.isDefault) {
      await this.monitoredRun('provider.create', insert);
      return;
    }
    await this.monitoredBatch('provider.create-default', [
      this.db.prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE user_id = ?').bind(provider.updatedAt, provider.userId),
      insert,
    ]);
  }

  async update(userId: string, id: string, patch: Partial<StoredProvider>, now: number): Promise<boolean> {
    if ((await this.schemaMode()) === 'legacy') {
      const columns: string[] = [];
      const values: BindValue[] = [];
      const fields: Array<[string, BindValue | undefined]> = [
        ['name', patch.name],
        ['server_url', patch.serverUrl],
        ['username_encrypted', patch.credentialsKeyId],
        ['password_encrypted', patch.credentialsEncrypted],
      ];
      for (const [column, value] of fields) {
        if (value !== undefined) {
          columns.push(`${column} = ?`);
          values.push(value);
        }
      }
      if (columns.length === 0) return true;
      columns.push('updated_at = ?');
      values.push(now, id, userId);
      const result = await this.monitoredRun(
        'provider.update',
        this.db.prepare(`UPDATE providers SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values),
      );
      return (result.meta.changes ?? 0) > 0;
    }

    const columns: string[] = [];
    const values: BindValue[] = [];
    const fields: Array<[string, BindValue | undefined]> = [
      ['name', patch.name],
      ['server_url', patch.serverUrl],
      ['credentials_encrypted', patch.credentialsEncrypted],
      ['credentials_key_id', patch.credentialsKeyId],
      ['status', patch.status],
      ['last_refreshed_at', patch.lastRefreshAt],
      ['metadata', patch.metadata ? JSON.stringify(patch.metadata) : undefined],
    ];
    for (const [column, value] of fields) {
      if (value !== undefined) {
        columns.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (columns.length === 0) return true;
    columns.push('updated_at = ?');
    values.push(now, id, userId);
    const result = await this.monitoredRun(
      'provider.update',
      this.db.prepare(`UPDATE providers SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values),
    );
    return (result.meta.changes ?? 0) > 0;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    if ((await this.schemaMode()) === 'legacy') {
      if (!(await this.find(userId, id))) return false;
      const playlistScope = 'playlist_id IN (SELECT id FROM playlists WHERE provider_id = ?)';
      const statements = [
        this.db.prepare(`DELETE FROM episodes WHERE series_id IN (SELECT id FROM series WHERE ${playlistScope})`).bind(id),
        this.db.prepare(`DELETE FROM series WHERE ${playlistScope}`).bind(id),
        this.db.prepare(`DELETE FROM channels WHERE ${playlistScope}`).bind(id),
        this.db.prepare(`DELETE FROM movies WHERE ${playlistScope}`).bind(id),
        this.db.prepare(`DELETE FROM categories WHERE ${playlistScope}`).bind(id),
        this.db.prepare('DELETE FROM playlists WHERE provider_id = ?').bind(id),
        this.db.prepare('DELETE FROM providers WHERE id = ? AND user_id = ?').bind(id, userId),
      ];
      const results = await this.monitoredBatch('provider.remove', statements);
      const removed = results[results.length - 1] as { meta?: { changes?: number } } | undefined;
      return (removed?.meta?.changes ?? 0) > 0;
    }

    const result = await this.monitoredRun(
      'provider.remove',
      this.db.prepare('DELETE FROM providers WHERE id = ? AND user_id = ?').bind(id, userId),
    );
    return (result.meta.changes ?? 0) > 0;
  }

  async setDefault(userId: string, id: string, now: number): Promise<boolean> {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    await this.monitoredBatch('provider.set-default', [
      this.db.prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE user_id = ?').bind(now, userId),
      this.db.prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?').bind(now, id, userId),
    ]);
    return true;
  }

  async loadCatalogKeys(userId: string, providerId: string): Promise<CatalogKeys> {
    if ((await this.schemaMode()) === 'legacy') {
      // Legacy tables have no external_id; saveCatalog derives stable IDs itself.
      return EMPTY_KEYS();
    }
    const [channels, movies, series, episodes, categories] = await Promise.all([
      Promise.resolve(this.db.prepare('SELECT external_id, id FROM channels WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>()),
      this.db.prepare('SELECT external_id, id FROM movies WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id FROM series WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id FROM episodes WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id, type FROM categories WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
    ]);
    const toMap = (rows: { results: CatalogKeyRow[] }) => new Map(rows.results.map((row) => [row.external_id, row.id] as const));
    const categoryMap = (rows: { results: CatalogKeyRow[] }) =>
      new Map(rows.results.map((row) => [`${row.type ?? 'channel'}:${row.external_id}`, row.id] as const));
    return {
      channels: toMap(channels),
      movies: toMap(movies),
      series: toMap(series),
      episodes: toMap(episodes),
      categories: categoryMap(categories),
    };
  }

  async saveImport(
    userId: string,
    providerId: string,
    checksum: string,
    stats: ImportStats,
    now: number,
  ): Promise<string> {
    if ((await this.schemaMode()) === 'legacy') {
      const playlistId = await legacyPlaylistId(providerId);
      await this.monitoredBatch('import.playlist-upsert', [
        this.db.prepare(LEGACY_PLAYLIST_UPSERT).bind(playlistId, providerId, 'Imported playlist', null, now, now),
        this.db.prepare('UPDATE providers SET updated_at = ? WHERE id = ? AND user_id = ?').bind(now, providerId, userId),
      ]);
      return playlistId;
    }

    const playlistId = crypto.randomUUID();
    const metadata = JSON.stringify({ lastImport: stats, checksum });
    await this.monitoredBatch('import.playlist-insert', [
      this.db
        .prepare('INSERT INTO playlists (id, user_id, provider_id, item_count, checksum, status, last_imported_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(playlistId, userId, providerId, stats.totalEntries, checksum, 'ready', now, now),
      this.db
        .prepare('UPDATE providers SET last_refreshed_at = ?, status = ?, metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(now, 'active', metadata, now, providerId, userId),
    ]);
    return playlistId;
  }

  async saveCatalog(
    userId: string,
    providerId: string,
    entries: M3uEntry[],
    keys: CatalogKeys,
    ids: { newId(): string },
    now: number,
    categories: CatalogCategory[] = [],
  ): Promise<{ added: number; updated: number; categoriesAdded: number }> {
    if ((await this.schemaMode()) === 'legacy') {
      return this.saveLegacyCatalog(providerId, entries, now, categories);
    }

    const statements: ProviderStatement[] = [];
    let added = 0;
    let updated = 0;
    let categoriesAdded = 0;
    const categoryIds = new Map(keys.categories);
    const seriesIds = new Map(keys.series);
    const categoryKey = (externalId: string, type: 'channel' | 'movie' | 'series') => `${type}:${externalId}`;

    const ensureCategory = (externalId: string, name: string, type: 'channel' | 'movie' | 'series') => {
      const key = categoryKey(externalId, type);
      let categoryId = categoryIds.get(key);
      if (!categoryId) {
        categoryId = ids.newId();
        categoryIds.set(key, categoryId);
        statements.push(
          this.db
            .prepare('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(categoryId, userId, providerId, externalId, name, type),
        );
        categoriesAdded += 1;
      }
      return categoryId;
    };

    for (const category of categories) {
      ensureCategory(category.externalId, category.name, category.type);
    }

    for (const entry of entries) {
      let categoryId: string | null = null;
      const type = entry.categoryType ?? 'channel';
      if (entry.categoryExternalId) {
        categoryId = ensureCategory(entry.categoryExternalId, entry.categoryName ?? entry.name, type);
      } else if (entry.groupTitle) {
        const externalId = `group:${entry.groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized'}`;
        categoryId = ensureCategory(externalId, entry.groupTitle, 'channel');
      }

      if (entry.kind === 'series') {
        const existing = keys.series.get(entry.externalId);
        if (existing) {
          statements.push(
            this.db
              .prepare('UPDATE series SET title = ?, poster_url = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
              .bind(entry.name, entry.posterUrl ?? null, entry.description ?? null, categoryId, now, existing, userId),
          );
          updated += 1;
        } else {
          const id = ids.newId();
          seriesIds.set(entry.externalId, id);
          statements.push(
            this.db
              .prepare('INSERT INTO series (id, user_id, provider_id, category_id, external_id, title, poster_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .bind(id, userId, providerId, categoryId, entry.externalId, entry.name, entry.posterUrl ?? null, entry.description ?? null, now, now),
          );
          added += 1;
        }
        continue;
      }

      const table = entry.kind === 'channel' ? 'channels' : entry.kind === 'movie' ? 'movies' : 'episodes';
      const existing = keys[table].get(entry.externalId);
      if (existing) {
        if (entry.kind === 'channel') {
          statements.push(
            this.db
              .prepare('UPDATE channels SET name = ?, stream_url = ?, tvg_id = ?, tvg_name = ?, logo_url = ?, channel_number = ?, country = ?, language = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
              .bind(entry.name, entry.streamUrl, entry.tvgId, entry.tvgName, entry.tvgLogo, entry.channelNumber, entry.country, entry.language, categoryId, now, existing, userId),
          );
        } else if (entry.kind === 'movie') {
          statements.push(
            this.db
              .prepare('UPDATE movies SET title = ?, stream_url = ?, poster_url = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
              .bind(entry.name, entry.streamUrl, entry.posterUrl ?? null, entry.description ?? null, categoryId, now, existing, userId),
          );
        } else {
          statements.push(
            this.db
              .prepare('UPDATE episodes SET title = ?, stream_url = ?, season_number = ?, episode_number = ?, updated_at = ? WHERE id = ? AND user_id = ?')
              .bind(entry.name, entry.streamUrl, entry.seasonNumber ?? null, entry.episodeNumber ?? null, now, existing, userId),
          );
        }
        updated += 1;
      } else {
        const id = ids.newId();
        if (entry.kind === 'channel') {
          statements.push(
            this.db
              .prepare('INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, tvg_id, tvg_name, logo_url, stream_url, channel_number, country, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .bind(id, userId, providerId, categoryId, entry.externalId, entry.name, entry.tvgId, entry.tvgName, entry.tvgLogo, entry.streamUrl, entry.channelNumber, entry.country, entry.language, now, now),
          );
        } else if (entry.kind === 'movie') {
          statements.push(
            this.db
              .prepare('INSERT INTO movies (id, user_id, provider_id, category_id, external_id, title, stream_url, poster_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .bind(id, userId, providerId, categoryId, entry.externalId, entry.name, entry.streamUrl, entry.posterUrl ?? null, entry.description ?? null, now, now),
          );
        } else {
          statements.push(
            this.db
              .prepare('INSERT INTO episodes (id, user_id, provider_id, series_id, external_id, title, stream_url, season_number, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .bind(id, userId, providerId, entry.seriesExternalId ? seriesIds.get(entry.seriesExternalId) ?? null : null, entry.externalId, entry.name, entry.streamUrl, entry.seasonNumber ?? null, entry.episodeNumber ?? null, now, now),
          );
        }
        added += 1;
      }
    }

    for (let index = 0; index < statements.length; index += CHUNK_SIZE) {
      await this.monitoredBatch('catalog.upsert-chunk', statements.slice(index, index + CHUNK_SIZE));
    }
    return { added, updated, categoriesAdded };
  }

  /** Writes against the exact legacy production tables, with idempotent IDs. */
  private async saveLegacyCatalog(
    providerId: string,
    entries: M3uEntry[],
    now: number,
    categories: CatalogCategory[],
  ): Promise<{ added: number; updated: number; categoriesAdded: number }> {
    const playlistId = await legacyPlaylistId(providerId);
    await this.monitoredRun(
      'catalog.playlist-upsert',
      this.db.prepare(LEGACY_PLAYLIST_UPSERT).bind(playlistId, providerId, 'Imported playlist', null, now, now),
    );

    const existingIds = new Map<string, Set<string>>();
    for (const table of ['channels', 'movies', 'series', 'categories'] as const) {
      const result = await this.db
        .prepare(`SELECT id FROM ${table} WHERE playlist_id = ?`)
        .bind(playlistId)
        .all<{ id: string }>();
      existingIds.set(table, new Set((result.results ?? []).map((row) => row.id)));
    }
    // M3U episodes may have no series link; include those stable IDs in the count.
    const episodeRows = await this.db
      .prepare('SELECT e.id FROM episodes e LEFT JOIN series s ON s.id = e.series_id WHERE s.playlist_id = ? OR e.series_id IS NULL')
      .bind(playlistId)
      .all<{ id: string }>();
    existingIds.set('episodes', new Set((episodeRows.results ?? []).map((row) => row.id)));

    const statements: ProviderStatement[] = [];
    let added = 0;
    let updated = 0;
    let categoriesAdded = 0;
    const categoryIds = new Map<string, string>();
    const seriesIds = new Map<string, string>();

    const countChange = (table: 'channels' | 'movies' | 'series' | 'episodes' | 'categories', id: string) => {
      if (existingIds.get(table)?.has(id)) updated += 1;
      else {
        added += 1;
        existingIds.get(table)?.add(id);
      }
    };

    const ensureCategory = async (externalId: string, name: string, type: 'channel' | 'movie' | 'series') => {
      const key = `${type}:${externalId}`;
      const existing = categoryIds.get(key);
      if (existing) return existing;
      const id = await stableId('cat', providerId, key);
      categoryIds.set(key, id);
      statements.push(
        this.db.prepare(LEGACY_CATEGORY_UPSERT).bind(id, playlistId, name, type, categoryIds.size),
      );
      if (existingIds.get('categories')?.has(id)) categoriesAdded += 0;
      else {
        categoriesAdded += 1;
        existingIds.get('categories')?.add(id);
      }
      return id;
    };

    for (const category of categories) {
      await ensureCategory(category.externalId, category.name, category.type);
    }

    for (const entry of entries) {
      let categoryId: string | null = null;
      const type = entry.categoryType ?? (entry.kind === 'episode' ? 'series' : entry.kind);
      if (entry.categoryExternalId) {
        categoryId = await ensureCategory(entry.categoryExternalId, entry.categoryName ?? entry.name, type);
      } else if (entry.groupTitle) {
        const externalId = `group:${entry.groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized'}`;
        categoryId = await ensureCategory(externalId, entry.groupTitle, type);
      }

      if (entry.kind === 'series') {
        const id = await stableId('se', providerId, entry.externalId);
        seriesIds.set(entry.externalId, id);
        statements.push(
          this.db
            .prepare(LEGACY_SERIES_UPSERT)
            .bind(id, playlistId, categoryId, entry.name, entry.posterUrl ?? entry.tvgLogo ?? null, null, entry.description ?? null),
        );
        countChange('series', id);
        continue;
      }

      if (entry.kind === 'channel') {
        const id = await stableId('ch', providerId, entry.externalId);
        statements.push(
          this.db
            .prepare(LEGACY_CHANNEL_UPSERT)
            .bind(id, playlistId, categoryId, entry.name, entry.streamUrl, entry.tvgLogo ?? null, entry.tvgId ?? null, entry.tvgName ?? null, 1),
        );
        countChange('channels', id);
      } else if (entry.kind === 'movie') {
        const id = await stableId('mv', providerId, entry.externalId);
        statements.push(
          this.db
            .prepare(LEGACY_MOVIE_UPSERT)
            .bind(id, playlistId, categoryId, entry.name, entry.streamUrl, entry.posterUrl ?? entry.tvgLogo ?? null, null, null, entry.description ?? null),
        );
        countChange('movies', id);
      } else {
        const id = await stableId('ep', providerId, entry.externalId);
        const seriesId = entry.seriesExternalId ? seriesIds.get(entry.seriesExternalId) ?? await stableId('se', providerId, entry.seriesExternalId) : null;
        statements.push(
          this.db
            .prepare(LEGACY_EPISODE_UPSERT)
            .bind(id, seriesId, entry.seasonNumber ?? null, entry.episodeNumber ?? null, entry.name, entry.streamUrl, null, entry.description ?? null),
        );
        countChange('episodes', id);
      }
    }

    for (let index = 0; index < statements.length; index += CHUNK_SIZE) {
      await this.monitoredBatch('catalog.legacy-upsert-chunk', statements.slice(index, index + CHUNK_SIZE));
    }
    return { added, updated, categoriesAdded };
  }

  async createImportJob(
    userId: string,
    providerId: string,
    filename: string,
    totalEntries: number,
    totalChunks: number,
    now: number,
  ): Promise<string> {
    const jobId = crypto.randomUUID();
    const expiresAt = now + 24 * 60 * 60; // 24 hours
    await this.monitoredBatch('import_job.create', [
      this.db
        .prepare(
          'INSERT INTO import_jobs (id, user_id, provider_id, filename, total_entries, total_chunks, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(jobId, userId, providerId, filename, totalEntries, totalChunks, 'pending', now, now, expiresAt),
    ]);
    return jobId;
  }

  async getImportJob(userId: string, jobId: string): Promise<ImportJob | null> {
    const row = await this.db
      .prepare(
        'SELECT id, user_id, provider_id, filename, total_entries, imported_entries, total_chunks, completed_chunks, status, error, created_at, updated_at, expires_at FROM import_jobs WHERE id = ? AND user_id = ?',
      )
      .bind(jobId, userId)
      .first<{
        id: string;
        user_id: string;
        provider_id: string;
        filename: string;
        total_entries: number;
        imported_entries: number;
        total_chunks: number;
        completed_chunks: number;
        status: ImportJobStatus;
        error: string | null;
        created_at: number;
        updated_at: number;
        expires_at: number;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      filename: row.filename,
      totalEntries: row.total_entries,
      importedEntries: row.imported_entries,
      totalChunks: row.total_chunks,
      completedChunks: row.completed_chunks,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  async updateImportJob(
    userId: string,
    jobId: string,
    patch: Partial<Pick<ImportJob, 'importedEntries' | 'completedChunks' | 'status' | 'error' | 'updatedAt'>>,
    now: number,
  ): Promise<boolean> {
    const columns: string[] = [];
    const values: BindValue[] = [];
    const fields: Array<[string, BindValue | undefined]> = [
      ['imported_entries', patch.importedEntries !== undefined ? patch.importedEntries : undefined],
      ['completed_chunks', patch.completedChunks !== undefined ? patch.completedChunks : undefined],
      ['status', patch.status !== undefined ? patch.status : undefined],
      ['error', patch.error !== undefined ? patch.error : undefined],
      ['updated_at', now],
    ];
    for (const [column, value] of fields) {
      if (value !== undefined) {
        columns.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (columns.length === 0) return true;
    const result = await this.monitoredRun(
      'import_job.update',
      this.db.prepare(`UPDATE import_jobs SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, jobId, userId),
    );
    return (result.meta.changes ?? 0) > 0;
  }

}
