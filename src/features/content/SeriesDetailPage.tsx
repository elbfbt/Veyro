import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ContentDetail } from '../../components/content/ContentDetail';
import { CatalogEmpty, CatalogError, CatalogSkeleton, PaginationControls } from '../../components/content/CatalogStates';
import { ContentCard } from '../../components/content/ContentCard';
import { errorMessage } from '../../hooks/useCatalog';
import { getEpisodes, getSeries } from '../../lib/contentApi';
import { groupEpisodes, seasonLabel } from '../../lib/content';
import type { EpisodeItem, SeriesItem } from '../../types/content';

export function SeriesDetailPage() {
  const { id = '' } = useParams();
  const [series, setSeries] = useState<SeriesItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [pagination, setPagination] = useState<Awaited<ReturnType<typeof getEpisodes>>['pagination'] | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([getSeries(id), getEpisodes(id, { page, limit: 50 })])
      .then(([seriesResult, episodeResult]) => {
        if (!active) return;
        setSeries(seriesResult.series);
        setEpisodes(episodeResult.episodes);
        setPagination(episodeResult.pagination);
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
  }, [id, page, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);
  const seasons = useMemo(() => groupEpisodes(episodes), [episodes]);

  if (loading) {
    return <div className="inner-page"><CatalogSkeleton count={6} /></div>;
  }
  if (error) {
    return <div className="inner-page"><CatalogError message={error} onRetry={retry} /></div>;
  }
  if (!series) {
    return <div className="inner-page"><CatalogEmpty title="Series not found" message="This series is not in your imported catalogue." /></div>;
  }

  return (
    <ContentDetail
      eyebrow="Series"
      title={series.title}
      description={series.description}
      art={series.posterUrl}
      category={series.categoryName}
      provider={series.providerName}
      meta={[series.year]}
      backTo="/series"
      backLabel="All series"
    >
      {seasons.length === 0 ? (
        <div className="empty-state">
          <h2>No episodes found</h2>
          <p>Episodes appear here when your provider exposes series metadata.</p>
        </div>
      ) : (
        <div className="season-list">
          {seasons.map((season) => (
            <section className="season-block" key={season.season ?? 'unknown'} aria-labelledby={`season-${season.season ?? 'unknown'}`}>
              <h2 id={`season-${season.season ?? 'unknown'}`}>{seasonLabel(season.season)}</h2>
              <div className="episode-list">
                {season.episodes.map((episode, index) => (
                  <ContentCard key={episode.id} item={episode} kind="episode" spatialId={`episode-${index}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <PaginationControls pagination={pagination} onPage={setPage} />
      <p className="content-detail__hint">
        <Link to="/settings#providers" className="text-link">Manage providers</Link> to refresh episode metadata.
      </p>
    </ContentDetail>
  );
}
