export type ProviderType = 'm3u_url' | 'm3u_file' | 'xtream';
export type ProviderStatus = 'active' | 'refreshing' | 'error' | 'disabled';

export interface ProviderImportStats {
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

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  isDefault: boolean;
  status: ProviderStatus;
  serverUrl: string | null;
  playlistUrl: string | null;
  lastRefreshAt: number | null;
  lastImport: ProviderImportStats | null;
  lastError: string | null;
  xtreamUsername: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: 'reachable' | 'unreachable' | 'local' | 'unsupported';
}
