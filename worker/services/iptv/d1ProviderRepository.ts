import type { ImportStats, M3uEntry, ProviderStatus, ProviderType, StoredProvider } from './types';

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

const CHUNK_SIZE = 400;

export type CatalogKeyRow = { external_id: string; id: string };
export type CatalogKeys = {
  channels: Map<string, string>;
  movies: Map<string, string>;
  series: Map<string, string>;
  episodes: Map<string, string>;
  categories: Map<string, string>;
};

export class D1ProviderRepository {
  constructor(private readonly db: ProviderDatabase) {}

  async list(userId: string): Promise<StoredProvider[]> {
    const result = await this.db
      .prepare('SELECT * FROM providers WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .bind(userId)
      .all<ProviderRow>();
    return (result.results ?? []).map(mapProvider);
  }

  async find(userId: string, id: string): Promise<StoredProvider | null> {
    const row = await this.db
      .prepare('SELECT * FROM providers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<ProviderRow>();
    return row ? mapProvider(row) : null;
  }

  async create(provider: StoredProvider): Promise<void> {
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
      await insert.run();
      return;
    }
    await this.db.batch([
      this.db.prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE user_id = ?').bind(provider.updatedAt, provider.userId),
      insert,
    ]);
  }

  async update(userId: string, id: string, patch: Partial<StoredProvider>, now: number): Promise<boolean> {
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
    const result = await this.db
      .prepare(`UPDATE providers SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM providers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async setDefault(userId: string, id: string, now: number): Promise<boolean> {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    await this.db.batch([
      this.db.prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE user_id = ?').bind(now, userId),
      this.db.prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?').bind(now, id, userId),
    ]);
    return true;
  }

  async loadCatalogKeys(userId: string, providerId: string): Promise<CatalogKeys> {
    const [channels, movies, series, episodes, categories] = await Promise.all([
      Promise.resolve(this.db.prepare('SELECT external_id, id FROM channels WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>()),
      this.db.prepare('SELECT external_id, id FROM movies WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id FROM series WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id FROM episodes WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
      this.db.prepare('SELECT external_id, id FROM categories WHERE user_id = ? AND provider_id = ?').bind(userId, providerId).all<CatalogKeyRow>(),
    ]);
    const toMap = (rows: { results: CatalogKeyRow[] }) => new Map(rows.results.map((row) => [row.external_id, row.id] as const));
    return {
      channels: toMap(channels),
      movies: toMap(movies),
      series: toMap(series),
      episodes: toMap(episodes),
      categories: toMap(categories),
    };
  }

  async saveImport(
    userId: string,
    providerId: string,
    checksum: string,
    stats: ImportStats,
    now: number,
  ): Promise<string> {
    const playlistId = crypto.randomUUID();
    const metadata = JSON.stringify({ lastImport: stats, checksum });
    await this.db.batch([
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
  ): Promise<{ added: number; updated: number; categoriesAdded: number }> {
    const statements: ProviderStatement[] = [];
    let added = 0;
    let updated = 0;
    let categoriesAdded = 0;
    const categoryIds = new Map(keys.categories);

    for (const entry of entries) {
      if (entry.groupTitle) {
        const externalId = `group:${entry.groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized'}`;
        let categoryId = categoryIds.get(externalId);
        if (!categoryId) {
          categoryId = ids.newId();
          categoryIds.set(externalId, categoryId);
          statements.push(
            this.db
              .prepare('INSERT INTO categories (id, user_id, provider_id, external_id, name, type) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(categoryId, userId, providerId, externalId, entry.groupTitle, 'channel'),
          );
          categoriesAdded += 1;
        }
      }

      const categoryId = entry.groupTitle
        ? categoryIds.get(`group:${entry.groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized'}`) ?? null
        : null;

      if (entry.kind === 'series') {
        const existing = keys.series.get(entry.externalId);
        if (existing) {
          statements.push(this.db.prepare('UPDATE series SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(entry.name, now, existing, userId));
          updated += 1;
        } else {
          statements.push(this.db.prepare('INSERT INTO series (id, user_id, provider_id, category_id, external_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(ids.newId(), userId, providerId, categoryId, entry.externalId, entry.name, now, now));
          added += 1;
        }
        continue;
      }

      const table = entry.kind === 'channel' ? 'channels' : entry.kind === 'movie' ? 'movies' : 'episodes';
      const existing = keys[table].get(entry.externalId);
      if (existing) {
        if (entry.kind === 'channel') {
          statements.push(this.db.prepare('UPDATE channels SET name = ?, stream_url = ?, tvg_id = ?, tvg_name = ?, logo_url = ?, channel_number = ?, country = ?, language = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(entry.name, entry.streamUrl, entry.tvgId, entry.tvgName, entry.tvgLogo, entry.channelNumber, entry.country, entry.language, categoryId, now, existing, userId));
        } else if (entry.kind === 'movie') {
          statements.push(this.db.prepare('UPDATE movies SET title = ?, stream_url = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(entry.name, entry.streamUrl, categoryId, now, existing, userId));
        } else {
          statements.push(this.db.prepare('UPDATE episodes SET title = ?, stream_url = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(entry.name, entry.streamUrl, now, existing, userId));
        }
        updated += 1;
      } else {
        const id = ids.newId();
        if (entry.kind === 'channel') {
          statements.push(this.db.prepare('INSERT INTO channels (id, user_id, provider_id, category_id, external_id, name, tvg_id, tvg_name, logo_url, stream_url, channel_number, country, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, userId, providerId, categoryId, entry.externalId, entry.name, entry.tvgId, entry.tvgName, entry.tvgLogo, entry.streamUrl, entry.channelNumber, entry.country, entry.language, now, now));
        } else if (entry.kind === 'movie') {
          statements.push(this.db.prepare('INSERT INTO movies (id, user_id, provider_id, category_id, external_id, title, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, userId, providerId, categoryId, entry.externalId, entry.name, entry.streamUrl, now, now));
        } else {
          statements.push(this.db.prepare('INSERT INTO episodes (id, user_id, provider_id, external_id, title, stream_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, userId, providerId, entry.externalId, entry.name, entry.streamUrl, now, now));
        }
        added += 1;
      }
    }

    for (let index = 0; index < statements.length; index += CHUNK_SIZE) {
      await this.db.batch(statements.slice(index, index + CHUNK_SIZE));
    }
    return { added, updated, categoriesAdded };
  }
}
