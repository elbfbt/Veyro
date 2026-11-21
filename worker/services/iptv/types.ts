export type MediaKind = 'channel' | 'movie' | 'series' | 'episode';

export type ProviderType = 'm3u_file' | 'm3u_url' | 'xtream';
export type ProviderStatus = 'active' | 'refreshing' | 'error' | 'disabled';

export interface StoredProvider {
  id: string;
  userId: string;
  name: string;
  type: ProviderType;
  serverUrl: string | null;
  credentialsEncrypted: string | null;
  credentialsKeyId: string | null;
  status: ProviderStatus;
  isDefault: boolean;
  lastRefreshAt: number | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderView {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  isDefault: boolean;
  status: ProviderStatus;
  serverUrl: string | null;
  playlistUrl: string | null;
  lastRefreshAt: number | null;
  lastImport: Record<string, unknown> | null;
  lastError: string | null;
  xtreamUsername: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProviderInput {
  name: string;
  type: ProviderType;
  url?: string;
  serverUrl?: string;
  username?: string;
  password?: string;
}

export interface UpdateProviderInput {
  name?: string;
  url?: string;
  serverUrl?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
}

export interface M3uEntry {
  externalId: string;
  name: string;
  streamUrl: string;
  tvgId: string | null;
  tvgName: string | null;
  tvgLogo: string | null;
  groupTitle: string | null;
  country: string | null;
  language: string | null;
  channelNumber: string | null;
  kind: MediaKind;
}

export interface ParsedPlaylist {
  entries: M3uEntry[];
  totalEntries: number;
  importedEntries: number;
  skippedEntries: number;
  duplicateEntries: number;
  malformedEntries: number;
}

export interface ImportStats {
  totalEntries: number;
  added: number;
  updated: number;
  skipped: number;
  duplicates: number;
  malformed: number;
  removed: number;
  categoriesAdded: number;
  durationMs: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: 'reachable' | 'unreachable' | 'local' | 'unsupported';
}

export interface PlaylistFetchResult {
  text: string;
  bytes: number;
}

export type PlaylistFetcher = (
  url: string,
  options?: { maxBytes?: number; timeoutMs?: number },
) => Promise<PlaylistFetchResult>;

export interface CatalogKeysView {
  channels: Map<string, string>;
  movies: Map<string, string>;
  series: Map<string, string>;
  episodes: Map<string, string>;
  categories: Map<string, string>;
}

export interface ProviderRepository {
  list(userId: string): Promise<StoredProvider[]>;
  find(userId: string, id: string): Promise<StoredProvider | null>;
  create(provider: StoredProvider): Promise<void>;
  update(userId: string, id: string, patch: Partial<StoredProvider>, now: number): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
  setDefault(userId: string, id: string, now: number): Promise<boolean>;
  loadCatalogKeys(userId: string, providerId: string): Promise<CatalogKeysView>;
  saveImport(userId: string, providerId: string, checksum: string, stats: ImportStats, now: number): Promise<string>;
  saveCatalog(
    userId: string,
    providerId: string,
    entries: M3uEntry[],
    keys: CatalogKeysView,
    ids: { newId(): string },
    now: number,
  ): Promise<{ added: number; updated: number; categoriesAdded: number }>;
}
