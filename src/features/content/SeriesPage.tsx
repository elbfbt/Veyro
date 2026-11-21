import { useCallback } from 'react';
import { listSeries } from '../../lib/contentApi';
import { CatalogBrowsePage } from './CatalogBrowsePage';

export function SeriesPage() {
  const loader = useCallback(async (query: Parameters<typeof listSeries>[0]) => {
    const result = await listSeries({ ...query, sort: 'title' });
    return { items: result.series, pagination: result.pagination };
  }, []);

  return (
    <CatalogBrowsePage
      eyebrow="Binge-worthy"
      title="Series"
      description="Browse imported shows. Open a series to see its seasons and episodes."
      kind="series"
      facetType="series"
      emptyTitle="No series found."
      emptyMessage="Add a provider or refresh your catalogue to import shows."
      searchLabel="Search series titles or categories"
      loader={loader}
    />
  );
}
