import { Info, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SafeArtwork } from '../content/SafeArtwork';
import { contentMeta } from '../../lib/content';
import type { MovieItem, SeriesItem } from '../../types/content';

interface HomeHeroProps {
  item: MovieItem | SeriesItem;
  kind: 'movie' | 'series';
}

/**
 * The newest movie (or series) becomes the one large, real feature on Home:
 * one primary Play action, one secondary Details link, no invented badges.
 */
export function HomeHero({ item, kind }: HomeHeroProps) {
  const title = kind === 'movie' ? (item as MovieItem).title : (item as SeriesItem).title;
  const art = kind === 'movie' ? (item as MovieItem).posterUrl : (item as SeriesItem).posterUrl;
  const meta = contentMeta([
    kind === 'movie' ? (item as MovieItem).year : (item as SeriesItem).year,
    item.categoryName,
    item.providerName,
  ]);

  return (
    <section className="hero hero--home" aria-labelledby="home-hero-title">
      <div className="hero__media">
        <SafeArtwork src={art} eager />
      </div>
      <div className="hero__gradients" aria-hidden="true" />
      <div className="hero__content">
        <p className="hero__eyebrow">{kind === 'movie' ? 'Newest movie' : 'Newest series'}</p>
        <h1 className="hero__title" id="home-hero-title">
          {title}
        </h1>
        {meta && <p className="hero__subtitle">{meta}</p>}
        <div className="hero__actions">
          <Link
            className="button button--primary"
            to={`/player/${kind}/${encodeURIComponent(item.id)}`}
            data-spatial="hero-play"
          >
            <Play size={18} aria-hidden="true" /> Play now
          </Link>
          <Link
            className="button button--ghost"
            to={`/details/${kind}/${encodeURIComponent(item.id)}`}
            data-spatial="hero-details"
          >
            <Info size={18} aria-hidden="true" /> Details
          </Link>
        </div>
      </div>
    </section>
  );
}
