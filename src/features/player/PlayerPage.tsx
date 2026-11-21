import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MonitorPlay, ShieldCheck } from 'lucide-react';
import { findDemoItem, heroSlides } from '../../data/demo';

export function PlayerPage() {
  const { id = '' } = useParams();
  const hero = heroSlides.find((slide) => slide.id === id);
  const item = hero ?? findDemoItem(id);

  if (!item) {
    return (
      <div className="inner-page phase-page">
        <div className="empty-state">
          <h1>Title not found</h1>
          <p>This demo item is not in the local catalogue.</p>
          <Link to="/" className="button button--ghost">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="player-page">
      <div className="player-frame">
        <img src={item.backdrop ?? item.image} alt="" />
        <div className="player-frame__scrim" aria-hidden="true" />
        <div className="player-frame__top">
          <Link to="/" className="button button--quiet" aria-label="Exit player">
            <ArrowLeft size={18} /> Exit player
          </Link>
          <span className="badge badge--neutral">
            <MonitorPlay size={14} /> Playback engine: Phase 5
          </span>
        </div>
        <div className="player-frame__center">
          <div className="player-frame__icon">
            <MonitorPlay size={44} strokeWidth={1.4} />
          </div>
          <h1>Player shell ready</h1>
          <p>
            Veyro will select native, HLS.js or Shaka playback based on the stream. Until that
            abstraction ships, no simulated video is shown here.
          </p>
        </div>
      </div>
      <section className="player-details" aria-label="Selected title details">
        <div>
          <p className="eyebrow">Selected title · demo</p>
          <h2>{item.title}</h2>
          <p>{item.subtitle ?? item.meta}</p>
        </div>
        <p className="player-details__description">{item.description}</p>
        <p className="player-details__privacy">
          <ShieldCheck size={16} /> Direct provider-to-device playback only. No video proxy endpoint exists.
        </p>
      </section>
    </div>
  );
}
