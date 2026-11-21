import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import type { Pagination } from '../../types/content';

export function CatalogSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="media-grid" aria-busy="true" aria-label="Loading catalogue">
      {Array.from({ length: count }, (_, index) => (
        <div className="media-card media-card--skeleton" key={index} aria-hidden="true">
          <span className="skeleton-block" />
        </div>
      ))}
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
