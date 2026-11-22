import { Bookmark, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ChannelItem, ContentKind, EpisodeItem, MovieItem, SeriesItem } from '../../types/content';
import { contentMeta } from '../../lib/content';
import { useOptionalLibrary, type LibraryEntry } from '../../state/LibraryContext';
import { useOptionalToast } from '../../state/ToastContext';
import { SafeArtwork } from './SafeArtwork';

export type CatalogEntry = ChannelItem | MovieItem | SeriesItem | EpisodeItem;

interface ContentCardProps {
  item: CatalogEntry;
  kind: ContentKind;
  spatialId?: string;
}

function details(item: CatalogEntry, kind: ContentKind) {
  if (kind === 'channel') {
    const channel = item as ChannelItem;
    return {
      title: channel.name,
      art: channel.logoUrl,
      meta: contentMeta([channel.categoryName, channel.country, channel.language]),
      badge: channel.channelNumber,
      live: true,
    };
  }
  if (kind === 'movie') {
    const movie = item as MovieItem;
    return {
      title: movie.title,
      art: movie.posterUrl,
      meta: contentMeta([movie.categoryName, movie.year]),
      badge: null,
      live: false,
    };
  }
  if (kind === 'series') {
    const series = item as SeriesItem;
    return {
      title: series.title,
      art: series.posterUrl,
      meta: contentMeta([series.categoryName, series.year]),
      badge: null,
      live: false,
    };
  }
  const episode = item as EpisodeItem;
  return {
    title: episode.title,
    art: null,
    meta: contentMeta([episode.seriesTitle, episode.seasonNumber && `S${episode.seasonNumber}`, episode.episodeNumber && `E${episode.episodeNumber}`]),
    badge: null,
    live: false,
  };
}

export function ContentCard({ item, kind, spatialId }: ContentCardProps) {
  const view = details(item, kind);
  const library = useOptionalLibrary();
  const toast = useOptionalToast();
  const favorite = library?.isFavorite(item.id) ?? false;
  const saved = library?.isInWatchlist(item.id) ?? false;

  const toggle = (target: 'favorite' | 'watchlist') => {
    if (!library) return;
    const entry: LibraryEntry = {
      id: item.id,
      kind,
      title: view.title,
      art: view.art,
      meta: view.meta || item.providerName,
      providerName: item.providerName,
    };
    const result =
      target === 'favorite' ? library.toggleFavorite(entry) : library.toggleWatchlist(entry);
    const label = target === 'favorite' ? 'favorites' : 'your watchlist';
    if (result.error) {
      toast?.showToast({ message: result.error, tone: 'error' });
      return;
    }
    if (result.added) {
      toast?.showToast({ message: `Added “${view.title}” to ${label}.`, tone: 'success' });
      return;
    }
    toast?.showToast({
      message: `Removed “${view.title}” from ${label}.`,
      action: {
        label: 'Undo',
        onAction: () =>
          target === 'favorite' ? library.toggleFavorite(entry) : library.toggleWatchlist(entry),
      },
    });
  };

  return (
    <article className={`media-card content-card content-card--${kind}`}>
      <Link
        className="media-card__link"
        to={`/details/${kind}/${encodeURIComponent(item.id)}`}
        data-spatial={spatialId ?? `content-${item.id}`}
        aria-label={`Open details for ${view.title}`}
      >
        <SafeArtwork src={view.art} />
        <span className="media-card__scrim" aria-hidden="true" />
        <span className="media-card__top" aria-hidden="true">
          {view.live ? (
            <span className="badge badge--live"><span className="badge__pulse" /> LIVE</span>
          ) : view.badge ? (
            <span className="badge">{view.badge}</span>
          ) : null}
        </span>
        <span className="media-card__info">
          <span className="media-card__title">{view.title}</span>
          <span className="media-card__meta">{view.meta || item.providerName}</span>
        </span>
      </Link>
      {library && (
        <span className="media-card__actions media-card__actions--always">
          <button
            type="button"
            className={`media-card__action${favorite ? ' is-active' : ''}`}
            aria-pressed={favorite}
            aria-label={`${favorite ? 'Remove' : 'Add'} ${view.title} ${favorite ? 'from' : 'to'} favorites`}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            data-spatial={`${spatialId ?? item.id}-favorite`}
            onClick={() => toggle('favorite')}
          >
            <Heart size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`media-card__action${saved ? ' is-active' : ''}`}
            aria-pressed={saved}
            aria-label={`${saved ? 'Remove' : 'Add'} ${view.title} ${saved ? 'from' : 'to'} watchlist`}
            title={saved ? 'Remove from watchlist' : 'Add to watchlist'}
            data-spatial={`${spatialId ?? item.id}-watchlist`}
            onClick={() => toggle('watchlist')}
          >
            <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        </span>
      )}
    </article>
  );
}
