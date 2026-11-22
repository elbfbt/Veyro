import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CatalogEmpty } from '../../components/content/CatalogStates';
import { SavedCard } from '../../components/library/SavedCard';
import { PageHeader } from '../../components/ui/PageHeader';
import { useLibrary, type LibraryEntry } from '../../state/LibraryContext';
import { useToast } from '../../state/ToastContext';

interface ShelfProps {
  eyebrow: string;
  title: string;
  description: string;
  entries: LibraryEntry[];
  listLabel: string;
  emptyTitle: string;
  emptyMessage: string;
  onRemove: (entry: LibraryEntry) => void;
  children?: ReactNode;
}

function Shelf({
  eyebrow,
  title,
  description,
  entries,
  listLabel,
  emptyTitle,
  emptyMessage,
  onRemove,
  children,
}: ShelfProps) {
  return (
    <div className="inner-page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <span className="result-count">
            {entries.length} {entries.length === 1 ? 'title' : 'titles'}
          </span>
        }
      />
      {children}
      {entries.length > 0 ? (
        <div className="media-grid">
          {entries.map((entry, index) => (
            <SavedCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              listLabel={listLabel}
              onRemove={() => onRemove(entry)}
              spatialId={`saved-${index}`}
              index={index}
            />
          ))}
        </div>
      ) : (
        <CatalogEmpty title={emptyTitle} message={emptyMessage} actionLabel="Browse movies" actionTo="/movies" />
      )}
    </div>
  );
}

export function FavoritesPage() {
  const { favorites, toggleFavorite } = useLibrary();
  const { showToast } = useToast();

  const remove = (entry: LibraryEntry) => {
    const result = toggleFavorite(entry);
    if (result.error) {
      showToast({ message: result.error, tone: 'error' });
      return;
    }
    showToast({
      message: `Removed “${entry.title}” from favorites.`,
      action: { label: 'Undo', onAction: () => toggleFavorite(entry) },
    });
  };

  return (
    <Shelf
      eyebrow="Saved by you"
      title="Favorites"
      description="Use the heart on any card to keep a title one tap away."
      entries={favorites}
      listLabel="favorites"
      emptyTitle="No favorites yet"
      emptyMessage="Use the heart on any channel, movie or series card and it will appear here."
      onRemove={remove}
    />
  );
}

export function WatchlistPage() {
  const { watchlist, toggleWatchlist } = useLibrary();
  const { showToast } = useToast();

  const remove = (entry: LibraryEntry) => {
    const result = toggleWatchlist(entry);
    if (result.error) {
      showToast({ message: result.error, tone: 'error' });
      return;
    }
    showToast({
      message: `Removed “${entry.title}” from your watchlist.`,
      action: { label: 'Undo', onAction: () => toggleWatchlist(entry) },
    });
  };

  return (
    <Shelf
      eyebrow="For later"
      title="Watchlist"
      description="Saved titles are stored on this device and open instantly, even before the catalogue loads."
      entries={watchlist}
      listLabel="your watchlist"
      emptyTitle="Nothing saved for later"
      emptyMessage="Use the bookmark on any card to build a watchlist for tonight."
      onRemove={remove}
    />
  );
}

export function HistoryPage() {
  return (
    <div className="inner-page">
      <PageHeader
        eyebrow="Playback"
        title="Watch history"
        description="What you watched and where you stopped will appear here."
      />
      <div className="empty-state catalog-empty">
        <h2>History is not recorded yet</h2>
        <p>
          Veyro does not store playback progress on this device, so there is nothing to resume here.
          Favorites and your watchlist work now.
        </p>
        <Link to="/movies" className="button button--primary" data-spatial="history-browse">
          Browse movies
        </Link>
      </div>
    </div>
  );
}
