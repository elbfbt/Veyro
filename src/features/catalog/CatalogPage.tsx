import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MediaCard } from '../../components/media/MediaCard';
import { PageHeader } from '../../components/ui/PageHeader';
import type { MediaItem, MediaKind } from '../../types/domain';

interface CatalogPageProps {
  eyebrow: string;
  title: string;
  description: string;
  items: MediaItem[];
  filters?: { label: string; value: MediaKind | 'all' }[];
  note?: string;
}

const defaultFilters = [
  { label: 'All', value: 'all' as const },
  { label: 'Channels', value: 'channel' as const },
  { label: 'Movies', value: 'movie' as const },
  { label: 'Shows', value: 'series' as const },
  { label: 'Episodes', value: 'episode' as const },
];

export function CatalogPage({ eyebrow, title, description, items, filters = defaultFilters, note }: CatalogPageProps) {
  const [filter, setFilter] = useState<MediaKind | 'all'>('all');
  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.kind === filter)),
    [filter, items],
  );

  return (
    <div className="inner-page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <span className="result-count">
            {visible.length} {visible.length === 1 ? 'title' : 'titles'}
          </span>
        }
      />
      <div className="filter-row" role="group" aria-label="Filter catalogue">
        {filters.map(({ label, value }) => (
          <button
            type="button"
            key={value}
            className={`filter-chip${filter === value ? ' is-active' : ''}`}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            data-spatial={`filter-${value}`}
          >
            {label}
          </button>
        ))}
      </div>
      {note && <p className="demo-note">{note}</p>}
      {visible.length > 0 ? (
        <div className="media-grid">
          {visible.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Try a different filter, or connect your own provider to populate this section.</p>
          <Link to="/tv/pair" className="button button--ghost">
            Add a playlist
          </Link>
        </div>
      )}
    </div>
  );
}
