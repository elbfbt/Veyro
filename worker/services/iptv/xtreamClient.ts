import { PlaylistLimitError } from './m3uParser';
import { UpstreamHttpError, UpstreamTimeoutError, type BoundedFetchLimits } from './fetchPlaylist';
import { UnsafeUrlError, assertSafePublicUrl } from './urlSafety';
import type { CatalogCategory, M3uEntry, XtreamCatalog, XtreamCredentials } from './types';

export type BoundedTextFetcher = (url: string, limits?: BoundedFetchLimits) => Promise<{ text: string; bytes: number }>;
export type CredentialResolver = () => Promise<XtreamCredentials>;

interface XtreamErrorDefinition {
  status: number;
  message: string;
}

const ERRORS: Record<string, XtreamErrorDefinition> = {
  invalid_provider_configuration: { status: 400, message: 'Invalid provider configuration.' },
  unsafe_provider_url: { status: 400, message: 'The provider URL is not allowed.' },
  provider_authentication_failed: { status: 502, message: 'Provider authentication failed.' },
  provider_unreachable: { status: 502, message: 'Provider unreachable.' },
  provider_timeout: { status: 504, message: 'Provider request timed out.' },
  provider_response_too_large: { status: 413, message: 'Provider response too large.' },
  invalid_provider_response: { status: 502, message: 'Provider returned invalid data.' },
  unsupported_provider_response: { status: 502, message: 'Unsupported provider response.' },
};

/** Messages are fixed strings; upstream bodies, URLs and credentials never enter them. */
export class XtreamClientError extends Error {
  constructor(
    public readonly code: keyof typeof ERRORS,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'XtreamClientError';
  }
}

function fail(code: keyof typeof ERRORS): never {
  const definition = ERRORS[code] ?? { status: 502, message: 'Provider request failed.' };
  throw new XtreamClientError(code, definition.status, definition.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function items(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('invalid_provider_response');
  return value.filter(isRecord);
}

/** Only the origin is used; user-supplied paths, queries and fragments are discarded. */
export function normalizeXtreamBase(raw: string): string {
  try {
    const url = assertSafePublicUrl(raw);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    if (error instanceof UnsafeUrlError) fail('unsafe_provider_url');
    fail('invalid_provider_configuration');
  }
}

function apiUrl(base: string, credentials: XtreamCredentials, action: string, seriesId?: string): string {
  const url = new URL('/player_api.php', base);
  url.search = '';
  // This is the only place credentials enter a URL, and it is internal to the Worker.
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  url.searchParams.set('action', action);
  if (seriesId) url.searchParams.set('series_id', seriesId);
  return url.toString();
}

export interface XtreamClientOptions {
  fetchText: BoundedTextFetcher;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
  maxTotalMs?: number;
  maxSeriesDetails?: number;
}

export class XtreamClient {
  private readonly fetchText: BoundedTextFetcher;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;
  private readonly maxTotalMs: number;
  private readonly maxTotalBytes: number;
  private readonly maxSeriesDetails: number;
  private deadline = 0;
  private totalBytes = 0;

  constructor(options: XtreamClientOptions) {
    this.fetchText = options.fetchText;
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxTotalMs = options.maxTotalMs ?? 30_000;
    this.maxTotalBytes = options.maxTotalBytes ?? 8 * 1024 * 1024;
    this.maxSeriesDetails = options.maxSeriesDetails ?? 25;
  }

  private beginRequest() {
    if (Date.now() >= this.deadline) fail('provider_timeout');
  }

  private async json(base: string, credentials: XtreamCredentials, action: string, seriesId?: string): Promise<unknown> {
    this.beginRequest();
    let body: string;
    try {
      const result = await this.fetchText(apiUrl(base, credentials, action, seriesId), {
        maxBytes: this.maxResponseBytes,
        timeoutMs: Math.max(1, Math.min(this.timeoutMs, this.deadline - Date.now())),
      });
      this.totalBytes += result.bytes;
      if (this.totalBytes > this.maxTotalBytes) fail('provider_response_too_large');
      body = result.text;
    } catch (error) {
      if (error instanceof XtreamClientError) throw error;
      if (error instanceof UpstreamHttpError && (error.status === 401 || error.status === 403)) {
        fail('provider_authentication_failed');
      }
      if (error instanceof UpstreamTimeoutError) fail('provider_timeout');
      if (error instanceof PlaylistLimitError) fail('provider_response_too_large');
      if (error instanceof UnsafeUrlError) fail('unsafe_provider_url');
      fail('provider_unreachable');
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      fail('invalid_provider_response');
    }
  }

  private async credentialsFrom(resolve: CredentialResolver): Promise<XtreamCredentials> {
    let credentials: XtreamCredentials;
    try {
      credentials = await resolve();
    } catch {
      fail('invalid_provider_configuration');
    }
    const username = typeof credentials.username === 'string' ? credentials.username.trim() : '';
    const password = typeof credentials.password === 'string' ? credentials.password : '';
    if (!username || username.length > 128 || !password || password.length > 256 || hasControlCharacters(username) || hasControlCharacters(password)) {
      fail('invalid_provider_configuration');
    }
    return { username, password };
  }

  async testConnection(serverUrl: string, resolve: CredentialResolver): Promise<void> {
    this.deadline = Date.now() + this.maxTotalMs;
    this.totalBytes = 0;
    const base = normalizeXtreamBase(serverUrl);
    const credentials = await this.credentialsFrom(resolve);
    await this.json(base, credentials, 'get_live_categories');
  }

  async fetchCatalog(serverUrl: string, resolve: CredentialResolver): Promise<XtreamCatalog> {
    this.deadline = Date.now() + this.maxTotalMs;
    this.totalBytes = 0;
    const base = normalizeXtreamBase(serverUrl);
    const credentials = await this.credentialsFrom(resolve);
    const entries: M3uEntry[] = [];
    const categories: CatalogCategory[] = [];
    const liveCategories = new Map<string, string>();
    const movieCategories = new Map<string, string>();
    const seriesCategories = new Map<string, string>();
    let skipped = 0;

    const collectCategories = (
      raw: unknown,
      type: CatalogCategory['type'],
      prefix: string,
      target: Map<string, string>,
    ) => {
      for (const item of items(raw)) {
        const id = text(item.category_id);
        const name = text(item.category_name);
        if (!id || !name) {
          skipped += 1;
          continue;
        }
        const externalId = `xtream:${prefix}:${id}`;
        target.set(id, name);
        categories.push({ externalId, name, type });
      }
    };

    collectCategories(await this.json(base, credentials, 'get_live_categories'), 'channel', 'live', liveCategories);
    collectCategories(await this.json(base, credentials, 'get_vod_categories'), 'movie', 'vod', movieCategories);
    collectCategories(await this.json(base, credentials, 'get_series_categories'), 'series', 'series', seriesCategories);

    for (const item of items(await this.json(base, credentials, 'get_live_streams'))) {
      const id = text(item.stream_id) ?? text(item.id);
      if (!id) {
        skipped += 1;
        continue;
      }
      const categoryId = text(item.category_id);
      const categoryName = categoryId ? liveCategories.get(categoryId) ?? null : null;
      entries.push({
        externalId: `xtream:live:${id}`,
        name: text(item.name) ?? `Channel ${id}`,
        streamUrl: `xtream://channel/${id}`,
        tvgId: text(item.tvg_id),
        tvgName: text(item.name),
        tvgLogo: text(item.stream_icon),
        groupTitle: categoryName,
        country: text(item.country),
        language: text(item.language),
        channelNumber: number(item.channel_number)?.toString() ?? text(item.num),
        kind: 'channel',
        categoryExternalId: categoryId ? `xtream:live:${categoryId}` : null,
        categoryName: categoryName ?? (categoryId ? `Live ${categoryId}` : null),
        categoryType: 'channel',
        description: text(item.plot, 500),
      });
    }

    for (const item of items(await this.json(base, credentials, 'get_vod_streams'))) {
      const id = text(item.stream_id) ?? text(item.id);
      if (!id) {
        skipped += 1;
        continue;
      }
      const categoryId = text(item.category_id);
      const categoryName = categoryId ? movieCategories.get(categoryId) ?? null : null;
      entries.push({
        externalId: `xtream:movie:${id}`,
        name: text(item.name) ?? `Movie ${id}`,
        streamUrl: `xtream://movie/${id}`,
        tvgId: null,
        tvgName: null,
        tvgLogo: null,
        groupTitle: categoryName,
        country: null,
        language: null,
        channelNumber: null,
        kind: 'movie',
        categoryExternalId: categoryId ? `xtream:vod:${categoryId}` : null,
        categoryName: categoryName ?? (categoryId ? `VOD ${categoryId}` : null),
        categoryType: 'movie',
        posterUrl: text(item.stream_icon),
        description: text(item.plot, 500),
      });
    }

    const seriesItems = items(await this.json(base, credentials, 'get_series'));
    const seriesRecords: Array<{ id: string; name: string }> = [];
    for (const item of seriesItems) {
      const id = text(item.series_id) ?? text(item.id);
      if (!id) {
        skipped += 1;
        continue;
      }
      const categoryId = text(item.category_id);
      const categoryName = categoryId ? seriesCategories.get(categoryId) ?? null : null;
      const name = text(item.name) ?? text(item.series_name) ?? `Series ${id}`;
      seriesRecords.push({ id, name });
      entries.push({
        externalId: `xtream:series:${id}`,
        name,
        streamUrl: `xtream://series/${id}`,
        tvgId: null,
        tvgName: null,
        tvgLogo: null,
        groupTitle: categoryName,
        country: null,
        language: null,
        channelNumber: null,
        kind: 'series',
        categoryExternalId: categoryId ? `xtream:series:${categoryId}` : null,
        categoryName: categoryName ?? (categoryId ? `Series ${categoryId}` : null),
        categoryType: 'series',
        posterUrl: text(item.cover),
        description: text(item.plot, 500),
      });
    }

    const detailed = seriesRecords.slice(0, this.maxSeriesDetails);
    const seriesDetailLimitReached = seriesRecords.length > detailed.length;
    if (seriesDetailLimitReached) skipped += seriesRecords.length - detailed.length;

    for (const series of detailed) {
      let payload: unknown;
      try {
        payload = await this.json(base, credentials, 'get_series_info', series.id);
      } catch (error) {
        // One broken series must not discard the rest of the catalogue.
        if (error instanceof XtreamClientError && error.code === 'provider_authentication_failed') throw error;
        if (error instanceof XtreamClientError && error.code === 'provider_timeout') throw error;
        if (error instanceof XtreamClientError && error.code === 'provider_response_too_large') throw error;
        skipped += 1;
        continue;
      }
      if (!isRecord(payload)) {
        skipped += 1;
        continue;
      }
      const episodeGroups = isRecord(payload.episodes)
        ? Object.values(payload.episodes).flat()
        : Array.isArray(payload.episodes)
          ? payload.episodes
          : [];
      for (const value of episodeGroups) {
        if (!isRecord(value)) {
          skipped += 1;
          continue;
        }
        const id = text(value.id) ?? text(value.episode_id);
        if (!id) {
          skipped += 1;
          continue;
        }
        entries.push({
          externalId: `xtream:episode:${id}`,
          name: text(value.title) ?? `Episode ${id}`,
          streamUrl: `xtream://episode/${id}`,
          tvgId: null,
          tvgName: null,
          tvgLogo: null,
          groupTitle: series.name,
          country: null,
          language: null,
          channelNumber: null,
          kind: 'episode',
          seriesExternalId: `xtream:series:${series.id}`,
          categoryExternalId: null,
          categoryName: null,
          categoryType: undefined,
          posterUrl: text(value.stream_icon),
          description: text(value.plot, 500),
          seasonNumber: number(value.season),
          episodeNumber: number(value.episode_num),
        });
      }
    }

    return { entries, categories, skipped, seriesDetailLimitReached };
  }
}
