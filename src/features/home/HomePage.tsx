import { QrCode, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ContentRow } from '../../components/media/ContentRow';
import { HeroCarousel } from '../../components/media/HeroCarousel';
import { contentRows, heroSlides } from '../../data/demo';

export function HomePage() {
  return (
    <div className="home-page">
      <HeroCarousel slides={heroSlides} />
      <div className="home-page__rows">
        {contentRows.map((row) => (
          <ContentRow key={row.id} row={row} />
        ))}
      </div>

      <section className="connect-banner" aria-labelledby="connect-banner-title">
        <div className="connect-banner__glow" aria-hidden="true" />
        <div className="connect-banner__icon">
          <QrCode size={28} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">
            <Sparkles size={14} aria-hidden="true" /> Your playlist, your rules
          </p>
          <h2 id="connect-banner-title">Add your source without typing on the TV</h2>
          <p>
            Veyro never bundles channels or credentials. Pair your phone with the TV, choose your own
            M3U playlist or provider, and stream directly from that provider to your device.
          </p>
        </div>
        <Link to="/tv/pair" className="button button--primary">
          Add playlist
        </Link>
      </section>

      <footer className="page-footer">
        <span>VEYRO · Demo catalogue</span>
        <span>Placeholder content only — connect your own source to see your channels.</span>
      </footer>
    </div>
  );
}
