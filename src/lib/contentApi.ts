import { apiRequest } from './api';
import type {
  CatalogQuery,
  ChannelItem,
  ContentCategory,
  ContentCategoryType,
  EpisodeItem,
  MovieItem,
  PageResult,
  ProviderSummary,
  SeriesItem,
} from '../types/content';

function queryString(query: CatalogQuery = {}): string {
  const params = new URLSearchParams();
  if (query.providerId) params.set('provider', query.providerId);
  if (query.categoryId) params.set('category', query.categoryId);
  if (query.search) params.set('q', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function listChannels(query: CatalogQuery = {}) {
  return apiRequest<{ channels: ChannelItem[]; pagination: PageResult<ChannelItem>['pagination'] }>(
    `/channels${queryString(query)}`,
  );
}

export function listMovies(query: CatalogQuery = {}) {
  return apiRequest<{ movies: MovieItem[]; pagination: PageResult<MovieItem>['pagination'] }>(
    `/movies${queryString(query)}`,
  );
}

export function listSeries(query: CatalogQuery = {}) {
  return apiRequest<{ series: SeriesItem[]; pagination: PageResult<SeriesItem>['pagination'] }>(
    `/series${queryString(query)}`,
  );
}

export function listCategories(type?: ContentCategoryType, providerId?: string) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (providerId) params.set('provider', providerId);
  const value = params.toString();
  return apiRequest<{ categories: ContentCategory[]; pagination: PageResult<ContentCategory>['pagination'] }>(
    `/categories${value ? `?${value}` : ''}`,
  );
}

export function listMyProviders() {
  return apiRequest<{ providers: ProviderSummary[] }>('/providers');
}

export function getChannel(id: string) {
  return apiRequest<{ channel: ChannelItem }>(`/channels/${encodeURIComponent(id)}`);
}

export function getMovie(id: string) {
  return apiRequest<{ movie: MovieItem }>(`/movies/${encodeURIComponent(id)}`);
}

export function getSeries(id: string) {
  return apiRequest<{ series: SeriesItem }>(`/series/${encodeURIComponent(id)}`);
}

export function getEpisodes(id: string, query: CatalogQuery = {}) {
  return apiRequest<{ episodes: EpisodeItem[]; pagination: PageResult<EpisodeItem>['pagination'] }>(
    `/series/${encodeURIComponent(id)}/episodes${queryString(query)}`,
  );
}

export function getEpisode(id: string) {
  return apiRequest<{ episode: EpisodeItem }>(`/episodes/${encodeURIComponent(id)}`);
}
