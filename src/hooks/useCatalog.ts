import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { listCategories, listMyProviders } from '../lib/contentApi';
import type { CatalogQuery, ContentCategory, PageResult, ProviderSummary } from '../types/content';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface CatalogState<T> {
  items: T[];
  pagination: PageResult<T>['pagination'] | null;
  loading: boolean;
  error: string;
}

const emptyPagination: PageResult<unknown>['pagination'] = {
  page: 1,
  limit: 24,
  total: 0,
  totalPages: 1,
  hasMore: false,
};

export function usePagedCatalog<T>(
  loader: (query: CatalogQuery) => Promise<{ items: T[]; pagination: PageResult<T>['pagination'] }>,
  query: CatalogQuery,
) {
  const [state, setState] = useState<CatalogState<T>>({
    items: [],
    pagination: emptyPagination as PageResult<T>['pagination'],
    loading: true,
    error: '',
  });
  const key = useMemo(() => JSON.stringify(query), [query]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await loader(query);
      setState({ items: result.items, pagination: result.pagination, loading: false, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    }
    // The serialized query is the stable dependency; callers memoize query objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, retry: load };
}

export function useCatalogFacets(type: ContentCategory['type']) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [providerResult, categoryResult] = await Promise.all([
        listMyProviders(),
        listCategories(type),
      ]);
      setProviders(providerResult.providers);
      setCategories(categoryResult.categories);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  return { providers, categories, loading, error, retry: load };
}
