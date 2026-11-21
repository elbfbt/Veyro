import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ContentDetail } from '../../components/content/ContentDetail';
import { CatalogEmpty, CatalogError } from '../../components/content/CatalogStates';
import { errorMessage } from '../../hooks/useCatalog';
import { getChannel, getEpisode, getMovie, getSeries } from '../../lib/contentApi';
import type { ChannelItem, ContentKind, EpisodeItem, MovieItem, SeriesItem } from '../../types/content';

type DetailItem = ChannelItem | MovieItem | SeriesItem | EpisodeItem;

function viewFor(kind: ContentKind, item: DetailItem) {
  if (kind === 'channel') {
    const channel = item as ChannelItem;
    return {
      eyebrow: 'Live channel',
      title: channel.name,
      description: [channel.country, channel.language].filter(Boolean).join(' · ') || null,
      art: channel.logoUrl,
      category: channel.categoryName,
      provider: channel.providerName,
      meta: [channel.channelNumber, channel.tvgName],
      backTo: '/live',
      backLabel: 'All channels',
    };
  }
  if (kind === 'movie') {
    const movie = item as MovieItem;
    return {
      eyebrow: 'Movie',
      title: movie.title,
      description: movie.description,
      art: movie.posterUrl,
      category: movie.categoryName,
      provider: movie.providerName,
      meta: [movie.year, movie.genre],
      backTo: '/movies',
      backLabel: 'All movies',
    };
  }
  if (kind === 'series') {
    const series = item as SeriesItem;
    return {
      eyebrow: 'Series',
      title: series.title,
      description: series.description,
      art: series.posterUrl,
      category: series.categoryName,
      provider: series.providerName,
      meta: [series.year, series.genre],
      backTo: '/series',
      backLabel: 'All series',
    };
  }
  const episode = item as EpisodeItem;
  return {
    eyebrow: 'Episode',
    title: episode.title,
    description: episode.description,
    art: null,
    category: episode.seriesTitle,
    provider: episode.providerName,
    meta: [episode.seasonNumber && `Season ${episode.seasonNumber}`, episode.episodeNumber && `Episode ${episode.episodeNumber}`],
    backTo: `/series/${encodeURIComponent(episode.seriesId)}`,
    backLabel: 'Series details',
  };
}

function isContentKind(value: string | undefined): value is ContentKind {
  return value === 'channel' || value === 'movie' || value === 'series' || value === 'episode';
}

export function ContentDetailsPage() {
  const { kind = '', id = '' } = useParams();
  const [item, setItem] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isContentKind(kind)) {
      setLoading(false);
      setError('Unknown content type.');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    const loader = kind === 'channel' ? getChannel : kind === 'movie' ? getMovie : kind === 'series' ? getSeries : getEpisode;
    void loader(id)
      .then((result) => {
        if (!active) return;
        const values = result as Record<string, DetailItem>;
        setItem(values[kind] ?? null);
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
  }, [kind, id, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  if (loading) return <div className="inner-page"><p className="provider-message">Loading details…</p></div>;
  if (error) return <div className="inner-page"><CatalogError message={error} onRetry={retry} /></div>;
  if (!item || !isContentKind(kind)) {
    return (
      <div className="inner-page">
        <CatalogEmpty
          title="Content not found"
          message="This item is no longer in your imported catalogue."
          actionLabel="Back to home"
          actionTo="/"
        />
      </div>
    );
  }

  const view = viewFor(kind, item);
  return (
    <ContentDetail {...view} kind={kind} contentId={item.id}>
      {kind === 'series' && (
        <p className="content-detail__hint">
          <Link to={`/series/${encodeURIComponent(item.id)}`} className="text-link">View seasons and episodes</Link>
        </p>
      )}
    </ContentDetail>
  );
}
