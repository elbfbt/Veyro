import { Link } from 'react-router-dom';
import { Heart, Play, Plus } from 'lucide-react';
import { useLibrary } from '../../state/LibraryContext';
import type { MediaItem } from '../../types/domain';

interface MediaCardProps {
  item: MediaItem;
  showProgress?: boolean;
  compact?: boolean;
  spatialId?: string;
}

export function MediaCard({ item, showProgress = true, compact = false, spatialId }: MediaCardProps) {
  const { isFavorite, toggleFavorite, isInWatchlist, toggleWatchlist } = useLibrary();
  const favorite = isFavorite(item.id);
  const inWatchlist = isInWatchlist(item.id);

  return (
    <article className={`media-card${compact ? ' media-card--compact' : ''}`}>
      <Link
        className="media-card__link"
        to={`/player/${item.id}`}
        data-spatial={spatialId ?? `card-${item.id}`}
        aria-label={`Open ${item.title}`}
      >
        <img src={item.image} alt="" loading="lazy" decoding="async" />
        <span className="media-card__scrim" aria-hidden="true" />
        <span className="media-card__top" aria-hidden="true">
          {item.isLive ? (
            <span className="badge badge--live">
              <span className="badge__pulse" /> LIVE
            </span>
          ) : item.channelNumber ? (
            <span className="badge">{item.channelNumber}</span>
          ) : item.badge ? (
            <span className="badge">{item.badge}</span>
          ) : null}
        </span>
        <span className="media-card__play" aria-hidden="true">
          <Play size={20} fill="currentColor" />
        </span>
        <span className="media-card__info">
          <span className="media-card__title">{item.title}</span>
          <span className="media-card__meta">{item.subtitle ?? item.meta ?? item.tags.join(' · ')}</span>
          {item.now && <span className="media-card__now">Now: {item.now.title}</span>}
        </span>
        {showProgress && item.progress !== undefined && (
          <span className="media-card__progress" aria-hidden="true">
            <span style={{ width: `${item.progress}%` }} />
          </span>
        )}
      </Link>
      <div className="media-card__actions">
        <button
          type="button"
          className={`media-card__action${favorite ? ' is-active' : ''}`}
          onClick={() => toggleFavorite(item.id)}
          aria-label={favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
          aria-pressed={favorite}
          data-spatial={`${spatialId ?? `card-${item.id}`}-favorite`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={`media-card__action${inWatchlist ? ' is-active' : ''}`}
          onClick={() => toggleWatchlist(item.id)}
          aria-label={inWatchlist ? `Remove ${item.title} from watchlist` : `Add ${item.title} to watchlist`}
          aria-pressed={inWatchlist}
          title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          <Plus size={16} />
        </button>
      </div>
    </article>
  );
}
