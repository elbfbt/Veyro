export type ContentKind = 'channel' | 'movie' | 'series' | 'episode';
export type ContentCategoryType = 'channel' | 'movie' | 'series';

export interface ProviderSummary {
  id: string;
  name: string;
  type: 'm3u_url' | 'm3u_file' | 'xtream';
  isDefault: boolean;
}

export interface ContentCategory {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  type: ContentCategoryType;
  itemCount: number;
}

export interface ChannelItem {
  id: string;
  providerId: string;
  providerName: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  tvgId: string | null;
  tvgName: string | null;
  logoUrl: string | null;
  channelNumber: string | null;
  country: string | null;
  language: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MovieItem {
  id: string;
  providerId: string;
  providerName: string;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  description: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number | null;
  genre: string | null;
  durationSec: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SeriesItem {
  id: string;
  providerId: string;
  providerName: string;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  description: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number | null;
  genre: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EpisodeItem {
  id: string;
  seriesId: string;
  seriesTitle: string | null;
  providerId: string;
  providerName: string;
  title: string;
  description: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  durationSec: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PageResult<T> {
  items: T[];
  pagination: Pagination;
}

export interface CatalogQuery {
  providerId?: string;
  categoryId?: string;
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}
