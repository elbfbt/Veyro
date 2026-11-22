import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SafeArtwork } from '../content/SafeArtwork';
import type { LibraryEntry } from '../../state/LibraryContext';

interface SavedCardProps {
  entry: LibraryEntry;
  listLabel: string;
  onRemove: () => void;
  spatialId?: string;
}

/** A saved catalogue snapshot — renders instantly from local storage. */
export function SavedCard({ entry, listLabel, onRemove, spatialId }: SavedCardProps) {
  const href = `/details/${entry.kind}/${encodeURIComponent(entry.id)}`;
  return (
    <article className="media-card content-card">
      <Link
        className="media-card__link"
        to={href}
        data-spatial={spatialId}
        aria-label={`Open details for ${entry.title}`}
      >
        <SafeArtwork src={entry.art} />
        <span className="media-card__scrim" aria-hidden="true" />
        <span className="media-card__info">
          <span className="media-card__title">{entry.title}</span>
          <span className="media-card__meta">{entry.meta || entry.providerName}</span>
        </span>
      </Link>
      <span className="media-card__actions media-card__actions--always">
        <button
          type="button"
          className="media-card__action"
          onClick={onRemove}
          aria-label={`Remove ${entry.title} from ${listLabel}`}
          title={`Remove from ${listLabel}`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </span>
    </article>
  );
}
