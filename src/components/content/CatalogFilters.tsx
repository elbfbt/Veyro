import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useCatalog';
import type { ContentCategory, ProviderSummary } from '../../types/content';

interface CatalogFiltersProps {
  providers: ProviderSummary[];
  categories: ContentCategory[];
  providerId: string;
  categoryId: string;
  search: string;
  onProviderChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  searchLabel?: string;
}

export function CatalogFilters({
  providers,
  categories,
  providerId,
  categoryId,
  search,
  onProviderChange,
  onCategoryChange,
  onSearchChange,
  searchLabel = 'Search catalogue',
}: CatalogFiltersProps) {
  const [term, setTerm] = useState(search);
  const debounced = useDebouncedValue(term);

  useEffect(() => {
    setTerm(search);
  }, [search]);

  useEffect(() => {
    if (debounced !== search) onSearchChange(debounced);
  }, [debounced, onSearchChange, search]);

  const visibleCategories = useMemo(
    () => categories.filter((category) => !providerId || category.providerId === providerId),
    [categories, providerId],
  );

  return (
    <div className="catalog-filters" role="group" aria-label="Catalogue filters">
      <label className="catalog-filter">
        <span>Provider</span>
        <select
          value={providerId}
          onChange={(event) => onProviderChange(event.target.value)}
          data-spatial="filter-provider"
        >
          <option value="">All providers</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <label className="catalog-filter">
        <span>Category</span>
        <select
          value={categoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
          data-spatial="filter-category"
        >
          <option value="">All categories</option>
          {visibleCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="catalog-filter catalog-filter--search">
        <span>Search</span>
        <span className="catalog-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            data-spatial="filter-search"
          />
          {term && (
            <button type="button" className="icon-button icon-button--small" onClick={() => setTerm('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </span>
      </label>
    </div>
  );
}
