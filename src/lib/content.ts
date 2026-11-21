import type { EpisodeItem } from '../types/content';

export interface SeasonGroup {
  season: number | null;
  episodes: EpisodeItem[];
}

function numberOrMax(value: number | null): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

/** Numeric ordering with null season/episode values placed last. */
export function groupEpisodes(episodes: EpisodeItem[]): SeasonGroup[] {
  const groups = new Map<number | null, EpisodeItem[]>();
  for (const episode of episodes) {
    const key = episode.seasonNumber;
    const list = groups.get(key) ?? [];
    list.push(episode);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([season, items]) => ({
      season,
      episodes: [...items].sort(
        (a, b) =>
          numberOrMax(a.episodeNumber) - numberOrMax(b.episodeNumber) ||
          a.title.localeCompare(b.title),
      ),
    }))
    .sort((a, b) => numberOrMax(a.season) - numberOrMax(b.season));
}

export function seasonLabel(season: number | null): string {
  return season === null ? 'Unspecified season' : `Season ${season}`;
}

export function episodeLabel(episode: EpisodeItem): string {
  if (episode.episodeNumber === null) return episode.title;
  return `${episode.episodeNumber}. ${episode.title}`;
}

export function contentMeta(values: Array<string | number | null | undefined>): string {
  return values.filter((value) => value !== null && value !== undefined && value !== '').join(' · ');
}
