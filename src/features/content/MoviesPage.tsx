import { useCallback } from 'react';
import { listMovies } from '../../lib/contentApi';
import { CatalogBrowsePage } from './CatalogBrowsePage';

export function MoviesPage() {
  const loader = useCallback(async (query: Parameters<typeof listMovies>[0]) => {
    const result = await listMovies({ ...query, sort: 'title' });
    return { items: result.movies, pagination: result.pagination };
  }, []);

  return (
    <CatalogBrowsePage
      eyebrow="Cinema"
      title="Movies"
      description="Browse imported movies from all of your providers."
      kind="movie"
      facetType="movie"
      emptyTitle="No movies found."
      emptyMessage="Add a provider or refresh your catalogue to import movies."
      searchLabel="Search movie titles or categories"
      loader={loader}
    />
  );
}
