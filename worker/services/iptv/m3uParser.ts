import { classifyParsedEntry } from './classifier';
import type { M3uEntry, ParsedPlaylist } from './types';

export const DEFAULT_MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_PLAYLIST_ENTRIES = 20_000;

export class PlaylistLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylistLimitError';
  }
}

interface PendingMetadata {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  country?: string;
  language?: string;
  channelNumber?: string;
  name?: string;
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"/g;
  for (const match of raw.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    if (key) attributes[key] = match[2] ?? '';
  }
  return attributes;
}

function deriveName(url: string): string {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop();
    return (path ?? url).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Unnamed stream';
  } catch {
    return 'Unnamed stream';
  }
}

function hasStreamScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function parseM3u(
  content: string,
  options: { maxBytes?: number; maxEntries?: number } = {},
): ParsedPlaylist {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PLAYLIST_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_PLAYLIST_ENTRIES;
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > maxBytes) throw new PlaylistLimitError('The playlist is too large to import.');

  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const firstMeaningful = lines.find((line) => line.trim());
  if (!firstMeaningful || !firstMeaningful.trim().toUpperCase().startsWith('#EXTM3U')) {
    throw new Error('The file is not a valid M3U playlist.');
  }

  const entries: M3uEntry[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  let pending: PendingMetadata | null = null;
  let totalEntries = 0;
  let skippedEntries = 0;
  let duplicateEntries = 0;
  let malformedEntries = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const body = line.slice('#EXTINF:'.length);
      const comma = body.indexOf(',');
      const attributes = parseAttributes(comma >= 0 ? body.slice(0, comma) : body);
      pending = {
        tvgId: attributes['tvg-id'] || undefined,
        tvgName: attributes['tvg-name'] || undefined,
        tvgLogo: attributes['tvg-logo'] || undefined,
        groupTitle: attributes['group-title'] || undefined,
        country: attributes['tvg-country'] || undefined,
        language: attributes['tvg-language'] || undefined,
        channelNumber: attributes['tvg-chno'] || attributes['channel-number'] || undefined,
        name: comma >= 0 ? body.slice(comma + 1).trim() || undefined : undefined,
      };
      continue;
    }

    if (line.startsWith('#')) continue;

    if (!hasStreamScheme(line)) {
      malformedEntries += 1;
      pending = null;
      continue;
    }

    totalEntries += 1;
    const metadata = pending ?? {};
    const name = metadata.name || metadata.tvgName || deriveName(line);
    const key = metadata.tvgId ? `tvg:${metadata.tvgId}` : `url:${line}`;

    if ((metadata.tvgId && seenIds.has(metadata.tvgId)) || seenUrls.has(line)) {
      duplicateEntries += 1;
      pending = null;
      continue;
    }
    if (metadata.tvgId) seenIds.add(metadata.tvgId);
    seenUrls.add(line);

    const entry: Omit<M3uEntry, 'kind'> = {
      externalId: metadata.tvgId || key,
      name,
      streamUrl: line,
      tvgId: metadata.tvgId ?? null,
      tvgName: metadata.tvgName ?? null,
      tvgLogo: metadata.tvgLogo ?? null,
      groupTitle: metadata.groupTitle ?? null,
      country: metadata.country ?? null,
      language: metadata.language ?? null,
      channelNumber: metadata.channelNumber ?? null,
    };

    if (entries.length >= maxEntries) {
      throw new PlaylistLimitError('The playlist contains too many entries to import.');
    }
    entries.push({ ...entry, kind: classifyParsedEntry(entry) });
    pending = null;
  }

  if (pending) malformedEntries += 1;
  skippedEntries = malformedEntries;

  return {
    entries,
    totalEntries,
    importedEntries: entries.length,
    skippedEntries,
    duplicateEntries,
    malformedEntries,
  };
}
