import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { MediaCard } from '../../components/media/MediaCard';
import { PageHeader } from '../../components/ui/PageHeader';
import { demoItems, heroSlides } from '../../data/demo';
import type { MediaItem } from '../../types/domain';

const searchable: MediaItem[] = [
  ...heroSlides.map(({ eyebrow: _eyebrow, headline: _headline, ...item }) => item),
  ...demoItems,
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(params.get('q') ?? '');
  }, [params]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '');
      if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return searchable;
    return searchable.filter((item) =>
      [item.title, item.subtitle, item.description, item.meta, ...item.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  const submit = (value: string) => {
    setQuery(value);
    setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
  };

  return (
    <div className="inner-page">
      <PageHeader
        eyebrow="Find something to watch"
        title="Search"
        description="Search the local demo catalogue by title, category or description. Provider-wide search uses the same abstraction in a later phase."
      />
      <form
        className="search-page__form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
      >
        <Search size={22} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “sci-fi”, “Orbit” or “live”"
          aria-label="Search catalogue"
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            onClick={() => submit('')}
            aria-label="Clear search"
          >
            <X size={18} />
          </button>
        )}
        <button type="submit" className="button button--primary">
          Search
        </button>
      </form>
      <p className="result-count" aria-live="polite">
        {results.length} {results.length === 1 ? 'result' : 'results'}
      </p>
      {results.length > 0 ? (
        <div className="media-grid">
          {results.map((item) => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No matches</h2>
          <p>Try another term. Results come from local demo data until a provider is connected.</p>
        </div>
      )}
    </div>
  );
}
