/**
 * Pure M3U parsing core.
 *
 * This module deliberately avoids DOM, Worker and File APIs so it can run
 * unchanged in the browser worker, on the main thread as a fallback, and in
 * unit tests. `createIncrementalM3uParser()` accepts the file in text slices
 * and returns the entries completed by each slice, which keeps memory bounded
 * for large playlists: the worker forwards entries to the importer instead of
 * retaining them. `parseM3u()` is the convenience wrapper for callers and tests
 * that already hold the whole file in memory.
 */

/** Maximum number of playable entries a single playlist may contribute. */
export const MAX_TOTAL_ENTRIES = 100_000;

export const INVALID_PLAYLIST_MESSAGE = 'The file is not a valid M3U playlist.';

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

function emptyPending(): PendingMetadata {
  return {
    tvgId: null,
    tvgName: null,
    tvgLogo: null,
    groupTitle: null,
    country: null,
    language: null,
    channelNumber: null,
    name: '',
  };
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

interface ParseState {
  seenIds: Set<string>;
  pending: PendingMetadata | null;
  totalEntries: number;
  maxEntries: number;
  sawMeaningfulLine: boolean;
}

/**
 * Feed a single line into the parser state.
 *
 * Returns a completed entry when the line was a playable stream URL, or null
 * for headers, comments and metadata lines.
 */
function consumeLine(state: ParseState, rawLine: string): M3uEntry | null {
  const line = rawLine.trim();
  if (!line) return null;

  if (!state.sawMeaningfulLine) {
    state.sawMeaningfulLine = true;
    if (!line.toUpperCase().startsWith('#EXTM3U')) {
      throw new Error(INVALID_PLAYLIST_MESSAGE);
    }
  }

  if (line.startsWith('#EXTINF:')) {
    const body = line.slice('#EXTINF:'.length);
    const comma = body.indexOf(',');
    const attributes = parseAttributes(comma >= 0 ? body.slice(0, comma) : body);
    state.pending = {
      tvgId: attributes['tvg-id'] ?? null,
      tvgName: attributes['tvg-name'] ?? null,
      tvgLogo: attributes['tvg-logo'] ?? null,
      groupTitle: attributes['group-title'] ?? null,
      country: attributes['tvg-country'] ?? null,
      language: attributes['tvg-language'] ?? null,
      channelNumber: attributes['tvg-chno'] ?? null,
      name: comma >= 0 ? body.slice(comma + 1).trim() : '',
    };
    return null;
  }

  if (!state.pending) {
    state.pending = emptyPending();
  }

  if (line.startsWith('#')) return null;

  if (!hasStreamScheme(line)) return null;

  state.totalEntries += 1;
  if (state.totalEntries > state.maxEntries) {
    throw new PlaylistLimitError(`Playlist exceeds ${state.maxEntries} entry limit.`);
  }

  const pending = state.pending;
  const streamUrl = line;
  const externalId =
    pending.tvgId ||
    pending.groupTitle ||
    streamUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 120);

  // Only the generated id has to be unique. Keying the loop on the stream URL
  // as well made it spin forever whenever a playlist repeated a URL (some
  // providers list the same stream under several names), which froze the UI.
  let key = externalId;
  let suffix = 1;
  while (state.seenIds.has(key)) {
    key = `${externalId}-${suffix}`;
    suffix += 1;
  }
  state.seenIds.add(key);

  const entry: M3uEntry = {
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
  };

  state.pending = null;
  return entry;
}

export interface IncrementalParseOptions {
  /** Entry cap, defaults to MAX_TOTAL_ENTRIES. Only overridden by tests. */
  maxEntries?: number;
}

export interface IncrementalParseResult {
  /** Entries completed by the final unterminated line (0 or 1). */
  entries: M3uEntry[];
  totalEntries: number;
}

export interface IncrementalM3uParser {
  readonly totalEntries: number;
  /** Parse the next slice of text; returns the entries it completed. */
  push(chunk: string): M3uEntry[];
  /** Flush the final line and validate that the playlist had a header. */
  finish(): IncrementalParseResult;
}

const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Create a streaming parser. Text can be pushed in arbitrary slices: a slice
 * may end in the middle of a line or even in the middle of a CRLF pair.
 */
export function createIncrementalM3uParser(
  options: IncrementalParseOptions = {},
): IncrementalM3uParser {
  const state: ParseState = {
    seenIds: new Set<string>(),
    pending: null,
    totalEntries: 0,
    maxEntries: options.maxEntries ?? MAX_TOTAL_ENTRIES,
    sawMeaningfulLine: false,
  };

  let carry = '';
  let sawFirstChunk = false;
  let finished = false;

  return {
    get totalEntries() {
      return state.totalEntries;
    },

    push(chunk: string): M3uEntry[] {
      if (finished) throw new Error('The M3U parser has already finished.');
      let text = chunk;
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      if (!text) return [];

      carry += text;
      const segments = carry.split(LINE_BREAK);
      carry = segments.pop() ?? '';

      const completed: M3uEntry[] = [];
      for (const segment of segments) {
        const entry = consumeLine(state, segment);
        if (entry) completed.push(entry);
      }
      return completed;
    },

    finish(): IncrementalParseResult {
      if (finished) return { entries: [], totalEntries: state.totalEntries };
      finished = true;

      const completed: M3uEntry[] = [];
      if (carry) {
        const entry = consumeLine(state, carry);
        carry = '';
        if (entry) completed.push(entry);
      }

      if (!state.sawMeaningfulLine) {
        throw new Error(INVALID_PLAYLIST_MESSAGE);
      }

      return { entries: completed, totalEntries: state.totalEntries };
    },
  };
}

/** Parse a complete playlist held in memory. */
export function parseM3u(
  content: string,
  options: IncrementalParseOptions = {},
): ParsedPlaylist {
  const parser = createIncrementalM3uParser(options);
  const entries = parser.push(content);
  const tail = parser.finish();
  entries.push(...tail.entries);
  return { entries, totalEntries: tail.totalEntries };
}

/** Split entries into chunks of up to chunkSize. */
export function chunkEntries<T>(entries: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < entries.length; i += chunkSize) {
    chunks.push(entries.slice(i, i + chunkSize));
  }
  return chunks;
}
