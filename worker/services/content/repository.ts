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

interface FilterParts {
  where: string;
  binds: BindValue[];
}

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

function filterParts(userId: string, query: CatalogQuery, searchFields: string[]): FilterParts {
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
  if (query.search) {
    clauses.push(`(${searchFields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const term = like(query.search);
    searchFields.forEach(() => binds.push(term));
  }
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

export class D1ContentRepository {
  constructor(private readonly db: ProviderDatabase) {}

  async findProvider(userId: string, id: string): Promise<ProviderSummary | null> {
    const row = await this.db
      .prepare('SELECT id, name, type, is_default FROM providers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<ProviderRow>();
    return row ? mapProvider(row) : null;
  }

  async findCategory(userId: string, id: string, type?: CategoryView['type']): Promise<CategoryView | null> {
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

  async listChannels(userId: string, query: CatalogQuery): Promise<PageResult<ChannelView>> {
    const { where, binds } = filterParts(userId, query, ['t.name', 't.tvg_name', 'c.name']);
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

  async findChannel(userId: string, id: string): Promise<ChannelView | null> {
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
    const { where, binds } = filterParts(userId, query, ['t.title', 'c.name']);
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

  async findMovie(userId: string, id: string): Promise<MovieView | null> {
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
    const { where, binds } = filterParts(userId, query, ['t.title', 'c.name']);
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

  async findSeries(userId: string, id: string): Promise<SeriesView | null> {
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
