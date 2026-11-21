import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { ContentCard } from '../../components/content/ContentCard';
import { CatalogEmpty, CatalogError, CatalogSkeleton } from '../../components/content/CatalogStates';
import { errorMessage } from '../../hooks/useCatalog';
import { listChannels, listMovies, listMyProviders, listSeries } from '../../lib/contentApi';
import { useAuth } from '../../state/AuthContext';
import type { ChannelItem, MovieItem, ProviderSummary, SeriesItem } from '../../types/content';

export function HomePage() {
  const { status } = useAuth();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anonymous') {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      listMyProviders(),
      listChannels({ sort: 'recent', limit: 8 }),
      listMovies({ sort: 'recent', limit: 8 }),
      listSeries({ sort: 'recent', limit: 8 }),
    ])
      .then(([providerResult, channelResult, movieResult, seriesResult]) => {
        if (!active) return;
        setProviders(providerResult.providers);
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
  }, [status, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  if (status === 'anonymous') {
    return (
      <div className="home-page home-empty">
        <CatalogEmpty
          title="Add your first provider to start watching"
          message="Sign in, then connect an M3U playlist, URL or Xtream provider in Settings."
          actionLabel="Sign in"
          actionTo="/login"
        />
      </div>
    );
  }

  if (loading) {
    return <div className="home-page home-empty"><CatalogSkeleton count={8} /></div>;
  }

  if (error) {
    return <div className="home-page home-empty"><CatalogError message={error} onRetry={retry} /></div>;
  }

  if (providers.length === 0) {
    return (
      <div className="home-page home-empty">
        <CatalogEmpty
          title="Add your first provider to start watching"
          message="Import an M3U file, M3U URL or Xtream catalogue. Your content will appear here immediately."
          actionLabel="Open Settings → Providers"
          actionTo="/settings#providers"
        />
      </div>
    );
  }

  const rows = [
    { id: 'channels', title: 'Live TV', to: '/live', items: channels, kind: 'channel' as const },
    { id: 'movies', title: 'Recently added movies', to: '/movies', items: movies, kind: 'movie' as const },
    { id: 'series', title: 'Recently added series', to: '/series', items: series, kind: 'series' as const },
  ];

  return (
    <div className="home-page">
      <section className="home-intro">
        <p className="eyebrow"><Sparkles size={14} /> Your catalogue</p>
        <h1>Welcome back</h1>
        <p>{providers.length} connected {providers.length === 1 ? 'provider' : 'providers'} · browse what you imported.</p>
        <div className="home-provider-list" aria-label="Your providers">
          {providers.map((provider) => (
            <span className="badge badge--neutral" key={provider.id}>{provider.name}</span>
          ))}
        </div>
      </section>

      {rows.filter((row) => row.items.length > 0).length === 0 ? (
        <div className="home-empty">
          <CatalogEmpty
            title="No imported content yet"
            message="Refresh a provider in Settings to bring channels, movies and series into Veyro."
            actionLabel="Manage providers"
            actionTo="/settings#providers"
          />
        </div>
      ) : (
        rows
          .filter((row) => row.items.length > 0)
          .map((row) => (
            <section className="content-row" key={row.id} aria-labelledby={`home-${row.id}`}>
              <div className="content-row__head">
                <h2 id={`home-${row.id}`}>{row.title}</h2>
                <Link to={row.to} className="content-row__more">See all <ArrowRight size={15} /></Link>
              </div>
              <div className="content-row__scroller">
                {row.items.map((item, index) => (
                  <ContentCard key={item.id} item={item} kind={row.kind} spatialId={`home-${row.id}-${index}`} />
                ))}
              </div>
            </section>
          ))
      )}

      <footer className="page-footer">
        <span>VEYRO · Your sources, your catalogue</span>
        <span>Playback is added in Phase 5. No video is relayed through Veyro.</span>
      </footer>
    </div>
  );
}
