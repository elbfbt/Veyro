import { safeImageUrl } from './sanitize';
import type {
  CategoriesQuery,
  CatalogQuery,
  CategoryView,
  ChannelView,
  EpisodeView,
  MovieView,
  PageResult,
  PaginationView,
  ProviderSummary,
  SeriesView,
} from './types';

// Minimal structural subset of D1 so this module typechecks in both tsconfigs.
type BindValue = string | number | boolean | null | ArrayBuffer | Uint8Array;

interface ProviderStatement {
  bind(...values: BindValue[]): ProviderStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

interface ProviderDatabase {
  prepare(sql: string): ProviderStatement;
}

interface ProviderRow {
  id: string;
  name: string;
  type: ProviderSummary['type'];
  is_default: number;
}

interface CategoryRow {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  type: CategoryView['type'];
  item_count: number;
}

interface ChannelRow {
  id: string;
  provider_id: string;
  provider_name: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  tvg_id: string | null;
  tvg_name: string | null;
  logo_url: string | null;
  channel_number: string | null;
  country: string | null;
  language: string | null;
  created_at: number;
  updated_at: number;
}

interface MovieRow {
  id: string;
  provider_id: string;
  provider_name: string;
  category_id: string | null;
  category_name: string | null;
  title: string;
  description: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  year: number | null;
  genre: string | null;
  duration_sec: number | null;
  created_at: number;
  updated_at: number;
}

interface SeriesRow {
  id: string;
  provider_id: string;
  provider_name: string;
  category_id: string | null;
  category_name: string | null;
  title: string;
  description: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  year: number | null;
  genre: string | null;
  created_at: number;
  updated_at: number;
}

interface EpisodeRow {
  id: string;
  series_id: string;
  series_title: string | null;
  provider_id: string;
  provider_name: string;
  title: string;
  description: string | null;
  season_number: number | null;
  episode_number: number | null;
  duration_sec: number | null;
  created_at: number;
  updated_at: number;
}

/** Rows produced by the legacy production schema via playlist timestamps. */
type LegacyCategoryRow = CategoryRow;
type LegacyChannelRow = Omit<ChannelRow, 'channel_number' | 'country' | 'language'>;
interface LegacyMovieRow extends Omit<MovieRow, 'title' | 'backdrop_url' | 'genre'> {
  name: string;
  logo_url: string | null;
}
interface LegacySeriesRow extends Omit<SeriesRow, 'title' | 'backdrop_url' | 'genre'> {
  name: string;
  logo_url: string | null;
}
interface LegacyEpisodeRow extends Omit<EpisodeRow, 'title'> {
  name: string;
}

interface FilterParts {
  where: string;
  binds: BindValue[];
}

type SchemaMode = 'rich' | 'legacy';

// Cache schema detection per D1 binding so each Worker request does not re-run PRAGMA.
const schemaCache = new WeakMap<object, Promise<SchemaMode>>();

const CHANNEL_SORTS: Record<string, string> = {
  name: 't.name COLLATE NOCASE ASC, t.id ASC',
  number: 'CAST(t.channel_number AS INTEGER) ASC, t.name COLLATE NOCASE ASC',
  recent: 't.created_at DESC, t.id ASC',
};

const TITLE_SORTS: Record<string, string> = {
  title: 't.title COLLATE NOCASE ASC, t.id ASC',
  year: 't.year DESC, t.title COLLATE NOCASE ASC',
  recent: 't.created_at DESC, t.id ASC',
};

// The legacy production tables have no content timestamps or channel numbers.
// Recent order uses the playlist import time, with a stable ID tie-breaker.
const LEGACY_CHANNEL_SORTS: Record<string, string> = {
  name: 't.name COLLATE NOCASE ASC, t.id ASC',
  number: 't.name COLLATE NOCASE ASC, t.id ASC',
  recent: 'pl.imported_at DESC, t.id ASC',
};

const LEGACY_TITLE_SORTS: Record<string, string> = {
  title: 't.name COLLATE NOCASE ASC, t.id ASC',
  year: 't.year DESC, t.name COLLATE NOCASE ASC',
  recent: 'pl.imported_at DESC, t.id ASC',
};

function pagination(page: number, limit: number, total: number): PaginationView {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasMore: page * limit < total,
  };
}

function like(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function searchClause(searchFields: string[], binds: BindValue[], search: string): string {
  const clause = `(${searchFields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  const term = like(search);
  searchFields.forEach(() => binds.push(term));
  return clause;
}

/** Rich schema (repository migrations): content rows carry user/provider IDs. */
function richFilterParts(userId: string, query: CatalogQuery, searchFields: string[]): FilterParts {
  const clauses = ['t.user_id = ?'];
  const binds: BindValue[] = [userId];
  if (query.providerId) {
    clauses.push('t.provider_id = ?');
    binds.push(query.providerId);
  }
  if (query.categoryId) {
    clauses.push('t.category_id = ?');
    binds.push(query.categoryId);
  }
  if (query.search) clauses.push(searchClause(searchFields, binds, query.search));
  return { where: clauses.join(' AND '), binds };
}

/**
 * Legacy production schema: ownership is reached through the playlist that
 * imported each content row, never through client-supplied IDs.
 */
function legacyFilterParts(userId: string, query: CatalogQuery, searchFields: string[]): FilterParts {
  const clauses = ['p.user_id = ?'];
  const binds: BindValue[] = [userId];
  if (query.providerId) {
    clauses.push('pl.provider_id = ?');
    binds.push(query.providerId);
  }
  if (query.categoryId) {
    clauses.push('t.category_id = ?');
    binds.push(query.categoryId);
  }
  if (query.search) clauses.push(searchClause(searchFields, binds, query.search));
  return { where: clauses.join(' AND '), binds };
}

function mapProvider(row: ProviderRow): ProviderSummary {
  return { id: row.id, name: row.name, type: row.type, isDefault: row.is_default === 1 };
}

function mapCategory(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    name: row.name,
    type: row.type,
    itemCount: row.item_count,
  };
}

function mapChannel(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    tvgId: row.tvg_id,
    tvgName: row.tvg_name,
    logoUrl: safeImageUrl(row.logo_url),
    channelNumber: row.channel_number,
    country: row.country,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLegacyChannel(row: LegacyChannelRow): ChannelView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    tvgId: row.tvg_id,
    tvgName: row.tvg_name,
    logoUrl: safeImageUrl(row.logo_url),
    channelNumber: null,
    country: null,
    language: null,
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

function mapMovie(row: MovieRow): MovieView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    title: row.title,
    description: row.description,
    posterUrl: safeImageUrl(row.poster_url),
    backdropUrl: safeImageUrl(row.backdrop_url),
    year: row.year,
    genre: row.genre,
    durationSec: row.duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLegacyMovie(row: LegacyMovieRow): MovieView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    title: row.name,
    description: row.description,
    posterUrl: safeImageUrl(row.logo_url),
    backdropUrl: null,
    year: row.year,
    genre: null,
    durationSec: row.duration_sec,
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

function mapSeries(row: SeriesRow): SeriesView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    title: row.title,
    description: row.description,
    posterUrl: safeImageUrl(row.poster_url),
    backdropUrl: safeImageUrl(row.backdrop_url),
    year: row.year,
    genre: row.genre,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLegacySeries(row: LegacySeriesRow): SeriesView {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    title: row.name,
    description: row.description,
    posterUrl: safeImageUrl(row.logo_url),
    backdropUrl: null,
    year: row.year,
    genre: null,
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

function mapEpisode(row: EpisodeRow): EpisodeView {
  return {
    id: row.id,
    seriesId: row.series_id,
    seriesTitle: row.series_title,
    providerId: row.provider_id,
    providerName: row.provider_name,
    title: row.title,
    description: row.description,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    durationSec: row.duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLegacyEpisode(row: LegacyEpisodeRow): EpisodeView {
  return {
    id: row.id,
    seriesId: row.series_id,
    seriesTitle: row.series_title,
    providerId: row.provider_id,
    providerName: row.provider_name,
    title: row.name,
    description: row.description,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    durationSec: row.duration_sec,
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

const LEGACY_CATEGORY_SELECT = `SELECT c.id, pl.provider_id, p.name AS provider_name, c.name, c.type,
  (CASE c.type
    WHEN 'channel' THEN (SELECT COUNT(*) FROM channels t WHERE t.category_id = c.id AND t.playlist_id = c.playlist_id)
    WHEN 'movie' THEN (SELECT COUNT(*) FROM movies t WHERE t.category_id = c.id AND t.playlist_id = c.playlist_id)
    ELSE (SELECT COUNT(*) FROM series t WHERE t.category_id = c.id AND t.playlist_id = c.playlist_id)
  END) AS item_count
  FROM categories c
  JOIN playlists pl ON pl.id = c.playlist_id
  JOIN providers p ON p.id = pl.provider_id`;

const LEGACY_CHANNEL_SELECT = `SELECT t.id, pl.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
  t.name, t.tvg_id, t.tvg_name, t.logo_url, pl.imported_at AS created_at, pl.updated_at AS updated_at
  FROM channels t
  JOIN playlists pl ON pl.id = t.playlist_id
  JOIN providers p ON p.id = pl.provider_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id`;

const LEGACY_MOVIE_SELECT = `SELECT t.id, pl.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
  t.name, t.description, t.logo_url, t.year, t.duration AS duration_sec, pl.imported_at AS created_at, pl.updated_at AS updated_at
  FROM movies t
  JOIN playlists pl ON pl.id = t.playlist_id
  JOIN providers p ON p.id = pl.provider_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id`;

const LEGACY_SERIES_SELECT = `SELECT t.id, pl.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
  t.name, t.description, t.logo_url, t.year, pl.imported_at AS created_at, pl.updated_at AS updated_at
  FROM series t
  JOIN playlists pl ON pl.id = t.playlist_id
  JOIN providers p ON p.id = pl.provider_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id`;

const LEGACY_EPISODE_SELECT = `SELECT e.id, e.series_id, s.name AS series_title, pl.provider_id, p.name AS provider_name,
  e.name, e.description, e.season_number, e.episode_number, e.duration AS duration_sec, pl.imported_at AS created_at, pl.updated_at AS updated_at
  FROM episodes e
  JOIN series s ON s.id = e.series_id
  JOIN playlists pl ON pl.id = s.playlist_id
  JOIN providers p ON p.id = pl.provider_id`;

export class D1ContentRepository {
  constructor(private readonly db: ProviderDatabase) {}

  /**
   * Phase 1/3 production D1 uses playlist-owned legacy tables. Repository
   * migrations use richer tables with direct user/provider ownership columns.
   * Detect once per repository instance and keep the public API unchanged.
   */
  private async schemaMode(): Promise<SchemaMode> {
    const key = this.db as object;
    let detected = schemaCache.get(key);
    if (!detected) {
      detected = (async () => {
        const result = await this.db.prepare('PRAGMA table_info(movies)').all<{ name: string }>();
        const columns = new Set((result.results ?? []).map((row) => row.name));
        return columns.has('user_id') ? 'rich' : 'legacy';
      })();
      schemaCache.set(key, detected);
    }
    return detected;
  }

  async findProvider(userId: string, id: string): Promise<ProviderSummary | null> {
    const row = await this.db
      .prepare('SELECT id, name, type, is_default FROM providers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<ProviderRow>();
    return row ? mapProvider(row) : null;
  }

  async findCategory(userId: string, id: string, type?: CategoryView['type']): Promise<CategoryView | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const typeClause = type ? ' AND c.type = ?' : '';
      const binds: BindValue[] = type ? [id, userId, type] : [id, userId];
      const row = await this.db
        .prepare(
          `SELECT c.id, pl.provider_id, p.name AS provider_name, c.name, c.type, 0 AS item_count
           FROM categories c
           JOIN playlists pl ON pl.id = c.playlist_id
           JOIN providers p ON p.id = pl.provider_id
           WHERE c.id = ? AND p.user_id = ?${typeClause}`,
        )
        .bind(...binds)
        .first<CategoryRow>();
      return row ? mapCategory(row) : null;
    }

    const typeClause = type ? ' AND c.type = ?' : '';
    const binds: BindValue[] = type ? [id, userId, type] : [id, userId];
    const row = await this.db
      .prepare(
        `SELECT c.id, c.provider_id, p.name AS provider_name, c.name, c.type, 0 AS item_count
         FROM categories c JOIN providers p ON p.id = c.provider_id AND p.user_id = c.user_id
         WHERE c.id = ? AND c.user_id = ?${typeClause}`,
      )
      .bind(...binds)
      .first<CategoryRow>();
    return row ? mapCategory(row) : null;
  }

  async listCategories(userId: string, query: CategoriesQuery): Promise<PageResult<CategoryView>> {
    if ((await this.schemaMode()) === 'legacy') return this.listLegacyCategories(userId, query);

    const clauses = ['c.user_id = ?'];
    const binds: BindValue[] = [userId];
    if (query.providerId) {
      clauses.push('c.provider_id = ?');
      binds.push(query.providerId);
    }
    if (query.type) {
      clauses.push('c.type = ?');
      binds.push(query.type);
    }
    const where = clauses.join(' AND ');
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM categories c
         JOIN providers p ON p.id = c.provider_id AND p.user_id = c.user_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `SELECT c.id, c.provider_id, p.name AS provider_name, c.name, c.type,
                (CASE c.type
                  WHEN 'channel' THEN (SELECT COUNT(*) FROM channels t WHERE t.category_id = c.id AND t.user_id = c.user_id)
                  WHEN 'movie' THEN (SELECT COUNT(*) FROM movies t WHERE t.category_id = c.id AND t.user_id = c.user_id)
                  ELSE (SELECT COUNT(*) FROM series t WHERE t.category_id = c.id AND t.user_id = c.user_id)
                END) AS item_count
         FROM categories c JOIN providers p ON p.id = c.provider_id AND p.user_id = c.user_id
         WHERE ${where}
         ORDER BY c.name COLLATE NOCASE ASC, c.id ASC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<CategoryRow>();
    return {
      items: (rows.results ?? []).map(mapCategory),
      pagination: pagination(query.page, query.limit, total),
    };
  }

  private async listLegacyCategories(userId: string, query: CategoriesQuery): Promise<PageResult<CategoryView>> {
    const clauses = ['p.user_id = ?'];
    const binds: BindValue[] = [userId];
    if (query.providerId) {
      clauses.push('pl.provider_id = ?');
      binds.push(query.providerId);
    }
    if (query.type) {
      clauses.push('c.type = ?');
      binds.push(query.type);
    }
    const where = clauses.join(' AND ');
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM categories c
         JOIN playlists pl ON pl.id = c.playlist_id
         JOIN providers p ON p.id = pl.provider_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `${LEGACY_CATEGORY_SELECT}
         WHERE ${where}
         ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC, c.id ASC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<LegacyCategoryRow>();
    return {
      items: (rows.results ?? []).map(mapCategory),
      pagination: pagination(query.page, query.limit, total),
    };
  }

  async listChannels(userId: string, query: CatalogQuery): Promise<PageResult<ChannelView>> {
    if ((await this.schemaMode()) === 'legacy') return this.listLegacyChannels(userId, query);

    const { where, binds } = richFilterParts(userId, query, ['t.name', 't.tvg_name', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM channels t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.name, t.tvg_id, t.tvg_name, t.logo_url, t.channel_number, t.country, t.language,
                t.created_at, t.updated_at
         FROM channels t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE ${where}
         ORDER BY ${CHANNEL_SORTS[query.sort ?? 'name'] ?? CHANNEL_SORTS.name}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<ChannelRow>();
    return { items: (rows.results ?? []).map(mapChannel), pagination: pagination(query.page, query.limit, total) };
  }

  private async listLegacyChannels(userId: string, query: CatalogQuery): Promise<PageResult<ChannelView>> {
    const { where, binds } = legacyFilterParts(userId, query, ['t.name', 't.tvg_name', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM channels t
         JOIN playlists pl ON pl.id = t.playlist_id
         JOIN providers p ON p.id = pl.provider_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `${LEGACY_CHANNEL_SELECT}
         WHERE ${where}
         ORDER BY ${LEGACY_CHANNEL_SORTS[query.sort ?? 'name'] ?? LEGACY_CHANNEL_SORTS.name}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<LegacyChannelRow>();
    return { items: (rows.results ?? []).map(mapLegacyChannel), pagination: pagination(query.page, query.limit, total) };
  }

  async findChannel(userId: string, id: string): Promise<ChannelView | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const row = await this.db
        .prepare(`${LEGACY_CHANNEL_SELECT} WHERE t.id = ? AND p.user_id = ?`)
        .bind(id, userId)
        .first<LegacyChannelRow>();
      return row ? mapLegacyChannel(row) : null;
    }

    const row = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.name, t.tvg_id, t.tvg_name, t.logo_url, t.channel_number, t.country, t.language,
                t.created_at, t.updated_at
         FROM channels t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE t.id = ? AND t.user_id = ?`,
      )
      .bind(id, userId)
      .first<ChannelRow>();
    return row ? mapChannel(row) : null;
  }

  async listMovies(userId: string, query: CatalogQuery): Promise<PageResult<MovieView>> {
    if ((await this.schemaMode()) === 'legacy') return this.listLegacyMovies(userId, query);

    const { where, binds } = richFilterParts(userId, query, ['t.title', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM movies t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.title, t.description, t.poster_url, t.backdrop_url, t.year, t.genre,
                t.duration_sec, t.created_at, t.updated_at
         FROM movies t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE ${where}
         ORDER BY ${TITLE_SORTS[query.sort ?? 'title'] ?? TITLE_SORTS.title}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<MovieRow>();
    return { items: (rows.results ?? []).map(mapMovie), pagination: pagination(query.page, query.limit, total) };
  }

  private async listLegacyMovies(userId: string, query: CatalogQuery): Promise<PageResult<MovieView>> {
    const { where, binds } = legacyFilterParts(userId, query, ['t.name', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM movies t
         JOIN playlists pl ON pl.id = t.playlist_id
         JOIN providers p ON p.id = pl.provider_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `${LEGACY_MOVIE_SELECT}
         WHERE ${where}
         ORDER BY ${LEGACY_TITLE_SORTS[query.sort ?? 'title'] ?? LEGACY_TITLE_SORTS.title}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<LegacyMovieRow>();
    return { items: (rows.results ?? []).map(mapLegacyMovie), pagination: pagination(query.page, query.limit, total) };
  }

  async findMovie(userId: string, id: string): Promise<MovieView | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const row = await this.db
        .prepare(`${LEGACY_MOVIE_SELECT} WHERE t.id = ? AND p.user_id = ?`)
        .bind(id, userId)
        .first<LegacyMovieRow>();
      return row ? mapLegacyMovie(row) : null;
    }

    const row = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.title, t.description, t.poster_url, t.backdrop_url, t.year, t.genre,
                t.duration_sec, t.created_at, t.updated_at
         FROM movies t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE t.id = ? AND t.user_id = ?`,
      )
      .bind(id, userId)
      .first<MovieRow>();
    return row ? mapMovie(row) : null;
  }

  async listSeries(userId: string, query: CatalogQuery): Promise<PageResult<SeriesView>> {
    if ((await this.schemaMode()) === 'legacy') return this.listLegacySeries(userId, query);

    const { where, binds } = richFilterParts(userId, query, ['t.title', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM series t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.title, t.description, t.poster_url, t.backdrop_url, t.year, t.genre,
                t.created_at, t.updated_at
         FROM series t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE ${where}
         ORDER BY ${TITLE_SORTS[query.sort ?? 'title'] ?? TITLE_SORTS.title}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<SeriesRow>();
    return { items: (rows.results ?? []).map(mapSeries), pagination: pagination(query.page, query.limit, total) };
  }

  private async listLegacySeries(userId: string, query: CatalogQuery): Promise<PageResult<SeriesView>> {
    const { where, binds } = legacyFilterParts(userId, query, ['t.name', 'c.name']);
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM series t
         JOIN playlists pl ON pl.id = t.playlist_id
         JOIN providers p ON p.id = pl.provider_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.playlist_id = t.playlist_id WHERE ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `${LEGACY_SERIES_SELECT}
         WHERE ${where}
         ORDER BY ${LEGACY_TITLE_SORTS[query.sort ?? 'title'] ?? LEGACY_TITLE_SORTS.title}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.limit, (query.page - 1) * query.limit)
      .all<LegacySeriesRow>();
    return { items: (rows.results ?? []).map(mapLegacySeries), pagination: pagination(query.page, query.limit, total) };
  }

  async findSeries(userId: string, id: string): Promise<SeriesView | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const row = await this.db
        .prepare(`${LEGACY_SERIES_SELECT} WHERE t.id = ? AND p.user_id = ?`)
        .bind(id, userId)
        .first<LegacySeriesRow>();
      return row ? mapLegacySeries(row) : null;
    }

    const row = await this.db
      .prepare(
        `SELECT t.id, t.provider_id, p.name AS provider_name, t.category_id, c.name AS category_name,
                t.title, t.description, t.poster_url, t.backdrop_url, t.year, t.genre,
                t.created_at, t.updated_at
         FROM series t
         JOIN providers p ON p.id = t.provider_id AND p.user_id = t.user_id
         LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE t.id = ? AND t.user_id = ?`,
      )
      .bind(id, userId)
      .first<SeriesRow>();
    return row ? mapSeries(row) : null;
  }

  async listEpisodes(userId: string, seriesId: string, page: number, limit: number): Promise<PageResult<EpisodeView>> {
    if ((await this.schemaMode()) === 'legacy') {
      const count = await this.db
        .prepare(
          `SELECT COUNT(*) AS total FROM episodes e
           JOIN series s ON s.id = e.series_id
           JOIN playlists pl ON pl.id = s.playlist_id
           JOIN providers p ON p.id = pl.provider_id
           WHERE p.user_id = ? AND e.series_id = ?`,
        )
        .bind(userId, seriesId)
        .first<{ total: number }>();
      const total = count?.total ?? 0;
      const rows = await this.db
        .prepare(
          `${LEGACY_EPISODE_SELECT}
           WHERE p.user_id = ? AND e.series_id = ?
           ORDER BY CASE WHEN e.season_number IS NULL THEN 1 ELSE 0 END ASC,
                    e.season_number ASC,
                    CASE WHEN e.episode_number IS NULL THEN 1 ELSE 0 END ASC,
                    e.episode_number ASC,
                    e.name COLLATE NOCASE ASC
           LIMIT ? OFFSET ?`,
        )
        .bind(userId, seriesId, limit, (page - 1) * limit)
        .all<LegacyEpisodeRow>();
      return { items: (rows.results ?? []).map(mapLegacyEpisode), pagination: pagination(page, limit, total) };
    }

    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM episodes e
         JOIN providers p ON p.id = e.provider_id AND p.user_id = e.user_id
         WHERE e.user_id = ? AND e.series_id = ?`,
      )
      .bind(userId, seriesId)
      .first<{ total: number }>();
    const total = count?.total ?? 0;
    const rows = await this.db
      .prepare(
        `SELECT e.id, e.series_id, s.title AS series_title, e.provider_id, p.name AS provider_name,
                e.title, e.description, e.season_number, e.episode_number, e.duration_sec,
                e.created_at, e.updated_at
         FROM episodes e
         JOIN providers p ON p.id = e.provider_id AND p.user_id = e.user_id
         LEFT JOIN series s ON s.id = e.series_id AND s.user_id = e.user_id
         WHERE e.user_id = ? AND e.series_id = ?
         ORDER BY CASE WHEN e.season_number IS NULL THEN 1 ELSE 0 END ASC,
                  e.season_number ASC,
                  CASE WHEN e.episode_number IS NULL THEN 1 ELSE 0 END ASC,
                  e.episode_number ASC,
                  e.title COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(userId, seriesId, limit, (page - 1) * limit)
      .all<EpisodeRow>();
    return { items: (rows.results ?? []).map(mapEpisode), pagination: pagination(page, limit, total) };
  }

  async findEpisode(userId: string, id: string): Promise<EpisodeView | null> {
    if ((await this.schemaMode()) === 'legacy') {
      const row = await this.db
        .prepare(`${LEGACY_EPISODE_SELECT} WHERE e.id = ? AND p.user_id = ?`)
        .bind(id, userId)
        .first<LegacyEpisodeRow>();
      return row ? mapLegacyEpisode(row) : null;
    }

    const row = await this.db
      .prepare(
        `SELECT e.id, e.series_id, s.title AS series_title, e.provider_id, p.name AS provider_name,
                e.title, e.description, e.season_number, e.episode_number, e.duration_sec,
                e.created_at, e.updated_at
         FROM episodes e
         JOIN providers p ON p.id = e.provider_id AND p.user_id = e.user_id
         LEFT JOIN series s ON s.id = e.series_id AND s.user_id = e.user_id
         WHERE e.id = ? AND e.user_id = ?`,
      )
      .bind(id, userId)
      .first<EpisodeRow>();
    return row ? mapEpisode(row) : null;
  }
}
