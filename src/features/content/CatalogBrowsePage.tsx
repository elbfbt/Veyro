import { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { CatalogEmpty, CatalogError, CatalogSkeleton, PaginationControls } from '../../components/content/CatalogStates';
import { CatalogFilters } from '../../components/content/CatalogFilters';
import { ContentCard, type CatalogEntry } from '../../components/content/ContentCard';
import { useAuth } from '../../state/AuthContext';
import { useCatalogFacets, usePagedCatalog } from '../../hooks/useCatalog';
import type { CatalogQuery, ContentCategory, ContentKind } from '../../types/content';

interface CatalogBrowsePageProps {
  eyebrow: string;
  title: string;
  description: string;
  kind: ContentKind;
  facetType: ContentCategory['type'];
  emptyTitle: string;
  emptyMessage: string;
  searchLabel: string;
  loader: (query: CatalogQuery) => Promise<{ items: CatalogEntry[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>;
}

export function CatalogBrowsePage({
  eyebrow,
  title,
  description,
  kind,
  facetType,
  emptyTitle,
  emptyMessage,
  searchLabel,
  loader,
}: CatalogBrowsePageProps) {
  const { status } = useAuth();
  const [providerId, setProviderId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const facets = useCatalogFacets(facetType);

  const query = useMemo<CatalogQuery>(
    () => ({ providerId, categoryId, search, page }),
    [providerId, categoryId, search, page],
  );
  const catalog = usePagedCatalog(loader, query);

  const changeProvider = useCallback((value: string) => {
    setProviderId(value);
    setCategoryId('');
    setPage(1);
  }, []);
  const changeCategory = useCallback((value: string) => {
    setCategoryId(value);
    setPage(1);
  }, []);
  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  if (status === 'anonymous') {
    return (
      <div className="inner-page">
        <PageHeader eyebrow={eyebrow} title={title} description={description} />
        <CatalogEmpty
          title="Sign in to browse your catalogue"
          message="Your providers and imported content are private to your account."
          actionLabel="Sign in"
          actionTo="/login"
        />
      </div>
    );
  }

  const visibleCategories = facets.categories.filter((category) => !providerId || category.providerId === providerId);

  return (
    <div className="inner-page catalog-page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <span className="result-count" aria-live="polite">
            {catalog.refreshing && <span className="catalog-updating">Updating…</span>}
            {catalog.pagination?.total ?? 0} items
          </span>
        }
      />

      <CatalogFilters
        providers={facets.providers}
        categories={facets.categories}
        providerId={providerId}
        categoryId={categoryId}
        search={search}
        onProviderChange={changeProvider}
        onCategoryChange={changeCategory}
        onSearchChange={changeSearch}
        searchLabel={searchLabel}
      />
      {facets.error && (
        <p className="filter-error" role="alert">
          Filters could not be loaded. <button type="button" className="text-link" onClick={() => void facets.retry()}>Retry</button>
        </p>
      )}

      {visibleCategories.length > 0 && (
        <div className="category-strip" role="group" aria-label="Browse by category">
          <button
            type="button"
            className={`filter-chip${!categoryId ? ' is-active' : ''}`}
            aria-pressed={!categoryId}
            onClick={() => changeCategory('')}
            data-spatial="category-all"
          >
            All
          </button>
          {visibleCategories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={`filter-chip${categoryId === category.id ? ' is-active' : ''}`}
              aria-pressed={categoryId === category.id}
              onClick={() => changeCategory(category.id)}
              data-spatial={`category-${category.id}`}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {catalog.error && catalog.items.length > 0 && (
        <p className="filter-error" role="alert">
          The last refresh failed. Showing the previous results.{' '}
          <button type="button" className="text-link" onClick={() => void catalog.retry()}>
            Retry
          </button>
        </p>
      )}

      {catalog.loading ? (
        <CatalogSkeleton />
      ) : catalog.error && catalog.items.length === 0 ? (
        <CatalogError message={catalog.error} onRetry={() => void catalog.retry()} />
      ) : catalog.items.length === 0 ? (
        <CatalogEmpty
          title={search ? `No results for "${search}"` : emptyTitle}
          message={search ? 'Try another title or clear your filters.' : emptyMessage}
        />
      ) : (
        <div className="media-grid" aria-busy={catalog.refreshing}>
          {catalog.items.map((item, index) => (
            <ContentCard
              key={item.id}
              item={item}
              kind={kind}
              index={index}
              spatialId={`${kind}-${index}`}
            />
          ))}
        </div>
      )}

      <PaginationControls pagination={catalog.pagination} onPage={setPage} />
    </div>
  );
}
