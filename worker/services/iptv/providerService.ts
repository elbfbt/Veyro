import { toBase64Url } from '../auth/tokens';
import { ProviderCredentialCipher } from './credentials';
import { PlaylistFetchError } from './fetchPlaylist';
import { parseM3u, PlaylistLimitError, DEFAULT_MAX_PLAYLIST_BYTES, DEFAULT_MAX_PLAYLIST_ENTRIES } from './m3uParser';
import { UnsafeUrlError, assertSafePublicUrl } from './urlSafety';
import type {
  ConnectionTestResult,
  CreateProviderInput,
  ImportStats,
  PlaylistFetcher,
  ProviderRepository,
  ProviderType,
  ProviderView,
  StoredProvider,
  UpdateProviderInput,
} from './types';

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function validName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  if (!name) throw new ProviderError('validation_error', 400, 'Enter a provider name.');
  return name;
}

function providerType(value: unknown): ProviderType {
  if (value === 'm3u_file' || value === 'm3u_url' || value === 'xtream') return value;
  throw new ProviderError('validation_error', 400, 'Unsupported provider type.');
}

function toView(provider: StoredProvider): ProviderView {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: provider.status !== 'disabled',
    isDefault: provider.isDefault,
    status: provider.status,
    serverUrl: provider.serverUrl,
    playlistUrl: provider.type === 'm3u_url' ? provider.serverUrl : null,
    lastRefreshAt: provider.lastRefreshAt,
    lastImport: (provider.metadata.lastImport as Record<string, unknown> | undefined) ?? null,
    lastError: typeof provider.metadata.lastError === 'string' ? provider.metadata.lastError : null,
    xtreamUsername: typeof provider.metadata.xtreamUsername === 'string' ? provider.metadata.xtreamUsername : null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function safeUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderError('validation_error', 400, `Enter a valid ${field}.`);
  }
  try {
    return assertSafePublicUrl(value.trim()).toString();
  } catch {
    throw new ProviderError('unsafe_url', 400, `The ${field} is not allowed.`);
  }
}

export interface ProviderServiceOptions {
  repository: ProviderRepository;
  cipher: ProviderCredentialCipher;
  ids: { newId(): string };
  clock: { now(): number };
  fetchPlaylist: PlaylistFetcher;
  maxBytes?: number;
  maxEntries?: number;
}

export class ProviderService {
  private readonly repository: ProviderRepository;
  private readonly cipher: ProviderCredentialCipher;
  private readonly ids: { newId(): string };
  private readonly clock: { now(): number };
  private readonly fetchPlaylist: PlaylistFetcher;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(options: ProviderServiceOptions) {
    this.repository = options.repository;
    this.cipher = options.cipher;
    this.ids = options.ids;
    this.clock = options.clock;
    this.fetchPlaylist = options.fetchPlaylist;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_PLAYLIST_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_PLAYLIST_ENTRIES;
  }

  async list(userId: string): Promise<ProviderView[]> {
    return (await this.repository.list(userId)).map(toView);
  }

  private async owned(userId: string, id: string): Promise<StoredProvider> {
    const provider = await this.repository.find(userId, id);
    if (!provider) throw new ProviderError('not_found', 404, 'Provider not found.');
    return provider;
  }

  async get(userId: string, id: string): Promise<ProviderView> {
    return toView(await this.owned(userId, id));
  }

  async create(userId: string, input: CreateProviderInput): Promise<ProviderView> {
    const type = providerType(input.type);
    const name = validName(input.name);
    const now = this.clock.now();
    let serverUrl: string | null = null;
    let credentialsEncrypted: string | null = null;
    let credentialsKeyId: string | null = null;
    let metadata: Record<string, unknown> = {};

    if (type === 'm3u_url') serverUrl = safeUrl(input.url, 'playlist URL');
    if (type === 'xtream') {
      serverUrl = safeUrl(input.serverUrl, 'server URL');
      if (typeof input.username !== 'string' || !input.username.trim()) throw new ProviderError('validation_error', 400, 'Enter an Xtream username.');
      if (typeof input.password !== 'string' || !input.password) throw new ProviderError('validation_error', 400, 'Enter an Xtream password.');
      const encrypted = await this.cipher.encrypt(JSON.stringify({ username: input.username.trim(), password: input.password }));
      credentialsEncrypted = encrypted.ciphertext;
      credentialsKeyId = encrypted.keyId;
      metadata = { xtreamUsername: input.username.trim() };
    }

    const existing = await this.repository.list(userId);
    const provider: StoredProvider = {
      id: this.ids.newId(),
      userId,
      name,
      type,
      serverUrl,
      credentialsEncrypted,
      credentialsKeyId,
      status: 'active',
      isDefault: existing.length === 0,
      lastRefreshAt: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(provider);
    return toView(provider);
  }

  async update(userId: string, id: string, input: UpdateProviderInput): Promise<ProviderView> {
    const provider = await this.owned(userId, id);
    const now = this.clock.now();
    const patch: Partial<StoredProvider> = {};
    if (input.name !== undefined) patch.name = validName(input.name);
    if (input.enabled !== undefined) patch.status = input.enabled ? 'active' : 'disabled';

    if (provider.type === 'm3u_url' && input.url !== undefined) patch.serverUrl = safeUrl(input.url, 'playlist URL');
    if (provider.type === 'xtream') {
      if (input.serverUrl !== undefined) patch.serverUrl = safeUrl(input.serverUrl, 'server URL');
      if (input.username !== undefined || input.password !== undefined) {
        if (typeof input.password !== 'string' || !input.password) {
          throw new ProviderError('validation_error', 400, 'Re-enter the password when changing Xtream credentials.');
        }
        const username = (input.username ?? provider.metadata.xtreamUsername ?? '').toString().trim();
        if (!username) throw new ProviderError('validation_error', 400, 'Enter an Xtream username.');
        const encrypted = await this.cipher.encrypt(JSON.stringify({ username, password: input.password }));
        patch.credentialsEncrypted = encrypted.ciphertext;
        patch.credentialsKeyId = encrypted.keyId;
        patch.metadata = { ...provider.metadata, xtreamUsername: username };
      }
    }

    await this.repository.update(userId, id, patch, now);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.repository.remove(userId, id);
  }

  async setDefault(userId: string, id: string): Promise<ProviderView> {
    await this.owned(userId, id);
    if (!(await this.repository.setDefault(userId, id, this.clock.now()))) {
      throw new ProviderError('not_found', 404, 'Provider not found.');
    }
    return this.get(userId, id);
  }

  async test(userId: string, id: string): Promise<ConnectionTestResult> {
    const provider = await this.owned(userId, id);
    if (provider.type === 'm3u_file') return { ok: true, status: 'local' };
    const target = provider.type === 'xtream' && provider.serverUrl
      ? new URL('/', provider.serverUrl).toString()
      : provider.serverUrl;
    if (!target) return { ok: false, status: 'unreachable' };
    try {
      await this.fetchPlaylist(target, { maxBytes: 1024, timeoutMs: 8_000 });
      return { ok: true, status: 'reachable' };
    } catch {
      return { ok: false, status: 'unreachable' };
    }
  }

  async refresh(userId: string, id: string): Promise<ImportStats> {
    const provider = await this.owned(userId, id);
    if (provider.type === 'm3u_file') {
      throw new ProviderError('refresh_unsupported', 400, 'Uploaded playlists cannot be refreshed. Upload an updated file instead.');
    }
    if (provider.type === 'xtream') {
      throw new ProviderError('refresh_unsupported', 501, 'Automatic Xtream catalogue refresh is not available yet.');
    }
    if (!provider.serverUrl) throw new ProviderError('invalid_provider', 400, 'The provider has no playlist URL.');
    await this.repository.update(userId, id, { status: 'refreshing' }, this.clock.now());
    try {
      const result = await this.fetchPlaylist(provider.serverUrl, { maxBytes: this.maxBytes });
      return await this.importText(userId, provider, result.text);
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'The playlist could not be refreshed.';
      await this.repository.update(
        userId,
        id,
        { status: 'error', metadata: { ...provider.metadata, lastError: message } },
        this.clock.now(),
      );
      throw error;
    }
  }

  async importFile(userId: string, name: string, content: string): Promise<ProviderView> {
    const providerName = validName(name);
    if (new TextEncoder().encode(content).byteLength > this.maxBytes) {
      throw new ProviderError('playlist_too_large', 413, 'The uploaded playlist is too large.');
    }
    const provider = await this.create(userId, { name: providerName, type: 'm3u_file' });
    try {
      const stored = await this.owned(userId, provider.id);
      await this.importText(userId, stored, content);
    } catch (error) {
      await this.repository.remove(userId, provider.id);
      throw error;
    }
    return this.get(userId, provider.id);
  }

  private async importText(userId: string, provider: StoredProvider, content: string): Promise<ImportStats> {
    const started = Date.now();
    let parsed;
    try {
      parsed = parseM3u(content, { maxBytes: this.maxBytes, maxEntries: this.maxEntries });
    } catch (error) {
      if (error instanceof PlaylistLimitError) throw new ProviderError('playlist_too_large', 413, error.message);
      throw new ProviderError('invalid_playlist', 400, 'The playlist is not valid M3U content.');
    }

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const checksum = toBase64Url(new Uint8Array(digest));
    const keys = await this.repository.loadCatalogKeys(userId, provider.id);
    const saved = await this.repository.saveCatalog(userId, provider.id, parsed.entries, keys, this.ids, this.clock.now());
    const stats: ImportStats = {
      totalEntries: parsed.totalEntries,
      added: saved.added,
      updated: saved.updated,
      skipped: parsed.skippedEntries,
      duplicates: parsed.duplicateEntries,
      malformed: parsed.malformedEntries,
      removed: 0,
      categoriesAdded: saved.categoriesAdded,
      durationMs: Date.now() - started,
    };
    await this.repository.saveImport(userId, provider.id, checksum, stats, this.clock.now());
    return stats;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isSafeProviderFailure(error: unknown): boolean {
  return error instanceof ProviderError || error instanceof UnsafeUrlError || error instanceof PlaylistFetchError || error instanceof PlaylistLimitError;
}
