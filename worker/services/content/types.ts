export type ContentType = 'channel' | 'movie' | 'series' | 'episode';

export interface ProviderSummary {
  id: string;
  name: string;
  type: 'm3u_url' | 'm3u_file' | 'xtream';
  isDefault: boolean;
}

export interface CategoryView {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  type: Exclude<ContentType, 'episode'>;
  itemCount: number;
}

export interface ChannelView {
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

export interface MovieView {
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

export interface SeriesView {
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

export interface EpisodeView {
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

export interface PaginationView {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PageResult<T> {
  items: T[];
  pagination: PaginationView;
}

export interface CatalogQuery {
  providerId?: string;
  categoryId?: string;
  search?: string;
  sort?: string;
  page: number;
  limit: number;
}

export interface CategoriesQuery {
  providerId?: string;
  type?: Exclude<ContentType, 'episode'>;
  page: number;
  limit: number;
}

/** Minimal data returned by the dedicated stream-resolution endpoint. */
export interface StreamSource {
  id: string;
  streamUrl: string;
  providerId: string;
  providerType: string;
}

/** Response from a dedicated stream-resolution endpoint. */
export interface StreamResolution {
  playable: boolean;
  /** Present only when playable is true. */
  streamUrl?: string;
  /** Present only when playable is false. */
  reason?: string;
}
