import type { D1ContentRepository } from './repository';
import type {
  CategoriesQuery,
  CatalogQuery,
  CategoryView,
  ChannelView,
  EpisodeView,
  MovieView,
  PageResult,
  SeriesView,
  StreamResolution,
} from './types';

export class ContentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

const MAX_ID_LENGTH = 128;
const MAX_SEARCH_LENGTH = 120;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;
const MAX_EPISODE_LIMIT = 200;
const MAX_CATEGORY_LIMIT = 500;

function value(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  return raw && raw.trim() ? raw.trim() : undefined;
}

function boundedInt(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ContentError('invalid_pagination', 400, 'Invalid pagination parameters.');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ContentError('invalid_pagination', 400, 'Pagination parameters are out of range.');
  }
  return parsed;
}

function catalogQuery(params: URLSearchParams): CatalogQuery {
  const search = value(params, 'q')?.slice(0, MAX_SEARCH_LENGTH);
  return {
    providerId: value(params, 'provider'),
    categoryId: value(params, 'category'),
    search,
    sort: value(params, 'sort'),
    page: boundedInt(value(params, 'page'), 1, MAX_PAGE),
    limit: boundedInt(value(params, 'limit'), 24, MAX_LIMIT),
  };
}

function categoriesQuery(params: URLSearchParams): CategoriesQuery {
  const type = value(params, 'type');
  if (type && type !== 'channel' && type !== 'movie' && type !== 'series') {
    throw new ContentError('invalid_filter', 400, 'Invalid category type.');
  }
  return {
    providerId: value(params, 'provider'),
    type: type as CategoriesQuery['type'],
    page: boundedInt(value(params, 'page'), 1, MAX_PAGE),
    limit: boundedInt(value(params, 'limit'), 200, MAX_CATEGORY_LIMIT),
  };
}

function checkId(id: string | undefined): string {
  if (!id || id.length > MAX_ID_LENGTH) throw new ContentError('not_found', 404, 'Content not found.');
  return id;
}

/** Only HTTP(S) stream URLs are safe for browser playback. */
function isSafeStreamUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export class ContentService {
  constructor(private readonly repository: D1ContentRepository) {}

  private async validateFilters(userId: string, query: CatalogQuery, type: CategoryView['type']): Promise<void> {
    if (query.providerId && !(await this.repository.findProvider(userId, checkId(query.providerId)))) {
      throw new ContentError('provider_not_found', 404, 'Provider not found.');
    }
    if (query.categoryId && !(await this.repository.findCategory(userId, checkId(query.categoryId), type))) {
      throw new ContentError('category_not_found', 404, 'Category not found.');
    }
  }

  async channels(userId: string, params: URLSearchParams): Promise<PageResult<ChannelView>> {
    const query = catalogQuery(params);
    await this.validateFilters(userId, query, 'channel');
    return this.repository.listChannels(userId, query);
  }

  async movies(userId: string, params: URLSearchParams): Promise<PageResult<MovieView>> {
    const query = catalogQuery(params);
    await this.validateFilters(userId, query, 'movie');
    return this.repository.listMovies(userId, query);
  }

  async series(userId: string, params: URLSearchParams): Promise<PageResult<SeriesView>> {
    const query = catalogQuery(params);
    await this.validateFilters(userId, query, 'series');
    return this.repository.listSeries(userId, query);
  }

  async categories(userId: string, params: URLSearchParams): Promise<PageResult<CategoryView>> {
    const query = categoriesQuery(params);
    if (query.providerId && !(await this.repository.findProvider(userId, checkId(query.providerId)))) {
      throw new ContentError('provider_not_found', 404, 'Provider not found.');
    }
    return this.repository.listCategories(userId, query);
  }

  async channel(userId: string, id: string): Promise<ChannelView> {
    const channel = await this.repository.findChannel(userId, checkId(id));
    if (!channel) throw new ContentError('not_found', 404, 'Channel not found.');
    return channel;
  }

  async movie(userId: string, id: string): Promise<MovieView> {
    const movie = await this.repository.findMovie(userId, checkId(id));
    if (!movie) throw new ContentError('not_found', 404, 'Movie not found.');
    return movie;
  }

  async seriesDetail(userId: string, id: string): Promise<SeriesView> {
    const series = await this.repository.findSeries(userId, checkId(id));
    if (!series) throw new ContentError('not_found', 404, 'Series not found.');
    return series;
  }

  async episodes(userId: string, id: string, params: URLSearchParams): Promise<PageResult<EpisodeView>> {
    const series = await this.repository.findSeries(userId, checkId(id));
    if (!series) throw new ContentError('not_found', 404, 'Series not found.');
    const page = boundedInt(value(params, 'page'), 1, MAX_PAGE);
    const limit = boundedInt(value(params, 'limit'), 50, MAX_EPISODE_LIMIT);
    return this.repository.listEpisodes(userId, series.id, page, limit);
  }

  async episode(userId: string, id: string): Promise<EpisodeView> {
    const episode = await this.repository.findEpisode(userId, checkId(id));
    if (!episode) throw new ContentError('not_found', 404, 'Episode not found.');
    return episode;
  }

  private streamResolution(source: { streamUrl: string; providerType: string } | null): StreamResolution {
    if (!source) throw new ContentError('not_found', 404, 'Content not found.');
    if (source.providerType === 'xtream') {
      return { playable: false, reason: 'xtream_web_playback_unsupported' };
    }
    if (source.providerType === 'm3u_file' || source.providerType === 'm3u_url') {
      if (!source.streamUrl) return { playable: false, reason: 'no_stream_url' };
      if (!isSafeStreamUrl(source.streamUrl)) {
        return { playable: false, reason: 'unsafe_stream_url' };
      }
      return { playable: true, streamUrl: source.streamUrl };
    }
    return { playable: false, reason: 'web_playback_unsupported' };
  }

  private toStreamSource(row: { stream_url: string; provider_type: string } | null): { streamUrl: string; providerType: string } | null {
    if (!row) return null;
    return { streamUrl: row.stream_url, providerType: row.provider_type };
  }

  async channelStream(userId: string, id: string): Promise<StreamResolution> {
    const source = await this.repository.findChannelStream(userId, checkId(id));
    return this.streamResolution(this.toStreamSource(source));
  }

  async movieStream(userId: string, id: string): Promise<StreamResolution> {
    const source = await this.repository.findMovieStream(userId, checkId(id));
    return this.streamResolution(this.toStreamSource(source));
  }

  async episodeStream(userId: string, id: string): Promise<StreamResolution> {
    const source = await this.repository.findEpisodeStream(userId, checkId(id));
    return this.streamResolution(this.toStreamSource(source));
  }
}
