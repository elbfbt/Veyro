const MAX_TOTAL_ENTRIES = 100_000;

interface PendingMetadata {
  tvgId: string | null;
  tvgName: string | null;
  tvgLogo: string | null;
  groupTitle: string | null;
  country: string | null;
  language: string | null;
  channelNumber: string | null;
  name: string;
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
  kind: 'channel' | 'movie' | 'series' | 'episode';
}

export interface ParsedPlaylist {
  entries: M3uEntry[];
  totalEntries: number;
}

export class PlaylistLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylistLimitError';
  }
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

function hasStreamScheme(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function parseM3u(content: string): ParsedPlaylist {
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

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const body = line.slice('#EXTINF:'.length);
      const comma = body.indexOf(',');
      const attributes = parseAttributes(comma >= 0 ? body.slice(0, comma) : body);
      pending = {
        tvgId: attributes['tvg-id'] ?? null,
        tvgName: attributes['tvg-name'] ?? null,
        tvgLogo: attributes['tvg-logo'] ?? null,
        groupTitle: attributes['group-title'] ?? null,
        country: attributes['tvg-country'] ?? null,
        language: attributes['tvg-language'] ?? null,
        channelNumber: attributes['tvg-chno'] ?? null,
        name: comma >= 0 ? body.slice(comma + 1).trim() : '',
      };
      continue;
    }

    if (!pending) {
      pending = { tvgId: null, tvgName: null, tvgLogo: null, groupTitle: null, country: null, language: null, channelNumber: null, name: '' };
    }

    if (line.startsWith('#')) continue;

    if (!hasStreamScheme(line)) continue;

    totalEntries++;
    if (totalEntries > MAX_TOTAL_ENTRIES) {
      throw new PlaylistLimitError(`Playlist exceeds ${MAX_TOTAL_ENTRIES} entry limit.`);
    }

    const streamUrl = line;
    const externalId =
      pending.tvgId ||
      pending.groupTitle ||
      streamUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 120);

    let key = externalId;
    let suffix = 1;
    while (seenIds.has(key) || seenUrls.has(streamUrl)) {
      key = `${externalId}-${suffix}`;
      suffix++;
    }
    seenIds.add(key);
    seenUrls.add(streamUrl);

    entries.push({
      externalId: key,
      name: pending.name || streamUrl,
      streamUrl,
      tvgId: pending.tvgId,
      tvgName: pending.tvgName,
      tvgLogo: pending.tvgLogo,
      groupTitle: pending.groupTitle,
      country: pending.country,
      language: pending.language,
      channelNumber: pending.channelNumber,
      kind: 'channel',
    });

    pending = null;
  }

  return { entries, totalEntries };
}

/** Split entries into chunks of up to chunkSize. */
export function chunkEntries<T>(entries: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < entries.length; i += chunkSize) {
    chunks.push(entries.slice(i, i + chunkSize));
  }
  return chunks;
}
