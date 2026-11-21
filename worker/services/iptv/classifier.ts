import type { M3uEntry, MediaKind } from './types';

const LIVE_GROUPS = [
  'news',
  'sports',
  'sport',
  'kids',
  'children',
  'documentary',
  'entertainment',
  'live',
  'local',
  'international',
  'music',
];

const MOVIE_SIGNALS = ['movie', 'movies', 'film', 'vod', '.mp4', '.mkv', '/movie/', '/movies/'];
const SERIES_SIGNALS = ['series', 'tvshow', 'tv shows', 'season', '/series/', '/shows/'];
const EPISODE_PATTERN = /(?:^|[\s/._-])s?\d{1,2}[xe]\d{1,2}(?:[\s/._-]|$)/i;

function matchesAny(value: string, signals: string[]): boolean {
  return signals.some((signal) => value.includes(signal));
}

/**
 * Best-effort provider-dependent classification. It deliberately favours a
 * conservative "channel" result when signals are weak; future phases can
 * replace this without changing the parser or import pipeline.
 */
export function classifyEntry(input: {
  groupTitle?: string | null;
  name: string;
  streamUrl: string;
}): MediaKind {
  const group = (input.groupTitle ?? '').toLowerCase();
  const name = input.name.toLowerCase();
  const url = input.streamUrl.toLowerCase();
  const combined = `${group} ${name} ${url}`;

  if (EPISODE_PATTERN.test(name) || url.includes('/episode/')) return 'episode';
  if (matchesAny(combined, MOVIE_SIGNALS) && !matchesAny(combined, SERIES_SIGNALS)) return 'movie';
  if (matchesAny(combined, SERIES_SIGNALS)) return 'series';
  if (matchesAny(group, LIVE_GROUPS)) return 'channel';
  return 'channel';
}

export function classifyParsedEntry(entry: Omit<M3uEntry, 'kind'>): MediaKind {
  return classifyEntry(entry);
}
