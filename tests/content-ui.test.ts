import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { CatalogEmpty, CatalogError, CatalogSkeleton } from '../src/components/content/CatalogStates';
import { CatalogFilters } from '../src/components/content/CatalogFilters';
import { ContentCard } from '../src/components/content/ContentCard';
import { episodeLabel, groupEpisodes, seasonLabel } from '../src/lib/content';
import { FALLBACK_ART, imageWithFallback, safeImageUrl } from '../src/lib/images';
import type { ChannelItem, EpisodeItem } from '../src/types/content';

function render(node: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, node));
}

const channel: ChannelItem = {
  id: 'ch-1',
  providerId: 'prov-1',
  providerName: 'Provider A',
  categoryId: 'cat-1',
  categoryName: 'News',
  name: 'Alpha News',
  tvgId: 'alpha',
  tvgName: 'Alpha TV',
  logoUrl: 'javascript:alert(1)',
  channelNumber: '101',
  country: 'US',
  language: 'English',
  createdAt: 1,
  updatedAt: 1,
};

const episode = (id: string, season: number | null, number: number | null, title: string): EpisodeItem => ({
  id,
  seriesId: 'se-1',
  seriesTitle: 'A Show',
  providerId: 'prov-1',
  providerName: 'Provider A',
  title,
  description: null,
  seasonNumber: season,
  episodeNumber: number,
  durationSec: null,
  createdAt: 1,
  updatedAt: 1,
});

describe('content helpers', () => {
  it('renders only safe artwork URLs and falls back on missing images', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl('https://user:pass@example.com/x.png')).toBeNull();
    expect(safeImageUrl('https://img.example.com/x.png')).toBe('https://img.example.com/x.png');
    expect(imageWithFallback(null)).toBe(FALLBACK_ART);
  });

  it('groups episodes by season and sorts numerically with nulls last', () => {
    const groups = groupEpisodes([
      episode('e4', null, null, 'Special'),
      episode('e2', 1, 2, 'Second'),
      episode('e1', 1, 1, 'First'),
      episode('e3', 2, 1, 'Finale'),
    ]);
    expect(groups.map((group) => group.season)).toEqual([1, 2, null]);
    expect(groups[0]?.episodes.map((item) => item.id)).toEqual(['e1', 'e2']);
    expect(seasonLabel(2)).toBe('Season 2');
    expect(episodeLabel(episode('e1', 1, 1, 'Pilot'))).toBe('1. Pilot');
  });
});

describe('catalogue UI states', () => {
  it('renders a channel card with a safe fallback image and detail link', () => {
    const html = render(createElement(ContentCard, { item: channel, kind: 'channel', spatialId: 'channel-0' }));
    expect(html).toContain(`src="${FALLBACK_ART}"`);
    expect(html).toContain('href="/details/channel/ch-1"');
    expect(html).toContain('Alpha News');
    expect(html).toContain('data-spatial="channel-0"');
  });

  it('renders loading, empty and error states with user-facing copy', () => {
    const skeleton = render(createElement(CatalogSkeleton, { count: 3 }));
    expect(skeleton).toContain('aria-busy="true"');

    const empty = render(
      createElement(CatalogEmpty, { title: 'No movies found', message: 'Add a provider to import movies.' }),
    );
    expect(empty).toContain('No movies found');
    expect(empty).toContain('/settings#providers');

    const error = render(createElement(CatalogError, { message: 'Request failed', onRetry: () => undefined }));
    expect(error).toContain('We could not load this catalogue');
    expect(error).toContain('Request failed');
  });

  it('renders provider and category filter options from imported data', () => {
    const html = render(
      createElement(CatalogFilters, {
        providers: [{ id: 'prov-1', name: 'Provider A', type: 'm3u_url', isDefault: true }],
        categories: [{ id: 'cat-1', providerId: 'prov-1', providerName: 'Provider A', name: 'News', type: 'channel', itemCount: 4 }],
        providerId: '',
        categoryId: '',
        search: '',
        onProviderChange: () => undefined,
        onCategoryChange: () => undefined,
        onSearchChange: () => undefined,
      }),
    );
    expect(html).toContain('All providers');
    expect(html).toContain('Provider A');
    expect(html).toContain('News');
    expect(html).toContain('data-spatial="filter-search"');
  });
});
