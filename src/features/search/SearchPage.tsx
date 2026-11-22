import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { ContentCard } from '../../components/content/ContentCard';
import { CatalogEmpty, CatalogError, CatalogSkeleton } from '../../components/content/CatalogStates';
import { PageHeader } from '../../components/ui/PageHeader';
import { errorMessage, useDebouncedValue } from '../../hooks/useCatalog';
import { listChannels, listMovies, listSeries } from '../../lib/contentApi';
import { useAuth } from '../../state/AuthContext';
import type { ChannelItem, MovieItem, SeriesItem } from '../../types/content';

export function SearchPage() {
  const { status } = useAuth();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(term.trim());
  const input = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setTerm(params.get('q') ?? '');
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

  useEffect(() => {
    if (status !== 'authenticated' || !debounced) {
      setChannels([]);
      setMovies([]);
      setSeries([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      listChannels({ search: debounced, limit: 12 }),
      listMovies({ search: debounced, limit: 12 }),
      listSeries({ search: debounced, limit: 12 }),
    ])
      .then(([channelResult, movieResult, seriesResult]) => {
        if (!active) return;
        setChannels(channelResult.channels);
        setMovies(movieResult.movies);
        setSeries(seriesResult.series);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debounced, status, reloadKey]);

  const submit = useCallback(
    (value: string) => {
      setTerm(value);
      setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
    },
    [setParams],
  );

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);
  const total = channels.length + movies.length + series.length;
  const sections = useMemo(
    () => [
      { title: 'Channels', kind: 'channel' as const, items: channels },
      { title: 'Movies', kind: 'movie' as const, items: movies },
      { title: 'Series', kind: 'series' as const, items: series },
    ],
    [channels, movies, series],
  );

  return (
    <div className="inner-page">
      <PageHeader
        eyebrow="Find something to watch"
        title="Search"
        description="Search your imported providers by title, tvg name and category. Results are limited and fetched from the server."
        actions={<span className="result-count">{debounced ? `${total} results` : 'Ready'}</span>}
      />
      <form
        className="search-page__form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(term);
        }}
      >
        <Search size={22} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={term}
          onChange={(event) => submit(event.target.value)}
          placeholder="Search your imported catalogue"
          aria-label="Search catalogue"
          data-spatial="search-input"
        />
        {term && (
          <button type="button" className="icon-button" onClick={() => submit('')} aria-label="Clear search">
            <X size={18} />
          </button>
        )}
      </form>

      {status === 'anonymous' ? (
        <CatalogEmpty title="Sign in to search" message="Search is scoped to your own imported catalogue." actionLabel="Sign in" actionTo="/login" />
      ) : !debounced ? (
        <div className="empty-state">
          <h2>Search your catalogue</h2>
          <p>Enter a channel, movie, series or category name to search across all of your providers.</p>
        </div>
      ) : loading ? (
        <CatalogSkeleton count={8} />
      ) : error ? (
        <CatalogError message={error} onRetry={retry} />
      ) : total === 0 ? (
        <div className="empty-state">
          <h2>No results for "{debounced}"</h2>
          <p>Try a shorter term or a different category.</p>
        </div>
      ) : (
        sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <section className="section-block" key={section.title} aria-labelledby={`search-${section.title}`}>
              <div className="section-block__head"><h2 id={`search-${section.title}`}>{section.title}</h2></div>
              <div className="media-grid">
                {section.items.map((item, index) => (
                  <ContentCard
                    key={item.id}
                    item={item}
                    kind={section.kind}
                    index={index}
                    spatialId={`search-${section.kind}-${index}`}
                  />
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}
