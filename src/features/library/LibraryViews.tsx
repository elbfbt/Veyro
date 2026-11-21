import { useMemo } from 'react';
import { CatalogPage } from '../catalog/CatalogPage';
import { contentRows, demoItems, heroSlides } from '../../data/demo';
import { useLibrary } from '../../state/LibraryContext';
import type { MediaItem } from '../../types/domain';

const allItems: MediaItem[] = [
  ...heroSlides.map(({ eyebrow: _eyebrow, headline: _headline, ...item }) => item),
  ...demoItems,
];

export function FavoritesPage() {
  const { favorites } = useLibrary();
  const items = useMemo(
    () => favorites.flatMap((id) => allItems.filter((item) => item.id === id)),
    [favorites],
  );

  return (
    <CatalogPage
      eyebrow="Saved by you"
      title="Favorites"
      description="Use the heart control on any card to build your favorites row."
      items={items}
      filters={[{ label: 'All', value: 'all' }]}
      note="Favorites are stored on this device for now. Accounts sync them in Phase 2."
    />
  );
}

export function WatchlistPage() {
  const { watchlist } = useLibrary();
  const items = useMemo(
    () => watchlist.flatMap((id) => allItems.filter((item) => item.id === id)),
    [watchlist],
  );

  return (
    <CatalogPage
      eyebrow="For later"
      title="Watchlist"
      description="Use the plus control on any card to add a title to your watchlist."
      items={items}
      filters={[{ label: 'All', value: 'all' }]}
      note="Your watchlist is stored on this device for now."
    />
  );
}

export function HistoryPage() {
  const historyItems = useMemo(
    () => [
      ...(contentRows.find((row) => row.id === 'continue')?.items ?? []),
      ...(contentRows.find((row) => row.id === 'recent')?.items ?? []),
    ],
    [],
  );

  return (
    <CatalogPage
      eyebrow="Pick up where you left off"
      title="Watch History"
      description="Progress and recent playback will be recorded here after the player ships."
      items={historyItems}
      filters={[{ label: 'All', value: 'all' }]}
      note="Clearly fictional demo progress. Real history is recorded by the player in Phase 5 and synced with accounts in Phase 2."
    />
  );
}
