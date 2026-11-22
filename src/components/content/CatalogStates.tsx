import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import type { Pagination } from '../../types/content';

export function CatalogSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="media-grid" aria-busy="true" aria-label="Loading catalogue">
      {Array.from({ length: count }, (_, index) => (
        <div
          className="media-card media-card--skeleton"
          key={index}
          style={{ '--stagger-index': Math.min(index, 9) } as CSSProperties}
          aria-hidden="true"
        >
          <span className="skeleton-block" />
        </div>
      ))}
    </div>
  );
}

/** Art + copy placeholders keep the details layout from jumping on load. */
export function DetailSkeleton() {
  return (
    <div className="inner-page" aria-busy="true" aria-label="Loading details">
      <div className="detail-skeleton">
        <span className="detail-skeleton__art skeleton-block" />
        <div className="detail-skeleton__body">
          <span className="skeleton-line skeleton-line--eyebrow" />
          <span className="skeleton-line skeleton-line--title" />
          <span className="skeleton-line skeleton-line--meta" />
          <span className="skeleton-line" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line--short" />
          <span className="skeleton-line skeleton-line--button" />
        </div>
      </div>
    </div>
  );
}

/** Reserves the featured area on the home page while the catalogue loads. */
export function HeroSkeleton() {
  return (
    <div className="hero-skeleton" aria-hidden="true">
      <span className="skeleton-block" />
    </div>
  );
}

export function CatalogEmpty({
  title,
  message,
  actionLabel = 'Add a provider',
  actionTo = '/settings#providers',
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  return (
    <div className="empty-state catalog-empty">
      <Inbox size={34} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      <Link to={actionTo} className="button button--primary" data-spatial="empty-action">
        {actionLabel}
      </Link>
    </div>
  );
}

export function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state catalog-empty" role="alert">
      <AlertCircle size={34} aria-hidden="true" />
      <h2>We could not load this catalogue</h2>
      <p>{message}</p>
      <button type="button" className="button button--ghost" onClick={onRetry} data-spatial="catalog-retry">
        <RefreshCw size={16} /> Retry
      </button>
    </div>
  );
}

export function PaginationControls({
  pagination,
  onPage,
}: {
  pagination: Pagination | null;
  onPage: (page: number) => void;
}) {
  if (!pagination || pagination.total === 0) return null;
  return (
    <nav className="pagination-controls" aria-label="Catalogue pages">
      <button
        type="button"
        className="button button--ghost"
        disabled={pagination.page <= 1}
        onClick={() => onPage(pagination.page - 1)}
        data-spatial="page-prev"
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} items
      </span>
      <button
        type="button"
        className="button button--ghost"
        disabled={!pagination.hasMore}
        onClick={() => onPage(pagination.page + 1)}
        data-spatial="page-next"
      >
        Next
      </button>
    </nav>
  );
}
