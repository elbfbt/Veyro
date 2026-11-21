import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, Play, Plus, X } from 'lucide-react';
import { useLibrary } from '../../state/LibraryContext';
import { usePreferences } from '../../state/PreferencesContext';
import type { HeroSlide } from '../../types/domain';

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const { isInWatchlist, toggleWatchlist } = useLibrary();
  const slide = slides[index];

  useEffect(() => {
    if (paused || detailsOpen || preferences.motion === 'reduced' || slides.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [paused, detailsOpen, preferences.motion, slides.length]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  if (!slide) return null;

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="hero__media" key={slide.id}>
        <img src={slide.backdrop ?? slide.image} alt="" fetchPriority="high" decoding="async" />
      </div>
      <div className="hero__gradients" aria-hidden="true" />
      <div className="hero__content">
        <p className="hero__eyebrow">{slide.eyebrow}</p>
        <div className="hero__tags">
          {slide.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <h1 className="hero__title">{slide.headline}</h1>
        <p className="hero__subtitle">{slide.subtitle}</p>
        <p className="hero__description">{slide.description}</p>
        <div className="hero__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate(`/player/${slide.id}`)}
            data-spatial="hero-play"
          >
            <Play size={19} fill="currentColor" /> Play now
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setDetailsOpen(true)}
            data-spatial="hero-details"
          >
            <Info size={18} /> More info
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => toggleWatchlist(slide.id)}
            aria-pressed={isInWatchlist(slide.id)}
            data-spatial="hero-watchlist"
          >
            <Plus size={18} /> {isInWatchlist(slide.id) ? 'In watchlist' : 'Watchlist'}
          </button>
        </div>
      </div>
      <div className="hero__dots" role="tablist" aria-label="Choose featured title">
        {slides.map((item, itemIndex) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            className={`hero__dot${itemIndex === index ? ' is-active' : ''}`}
            aria-selected={itemIndex === index}
            aria-label={`Show ${item.title}`}
            onClick={() => setIndex(itemIndex)}
            data-spatial={`hero-dot-${item.id}`}
          />
        ))}
      </div>

      {detailsOpen && (
        <div className="modal-scrim" onClick={() => setDetailsOpen(false)}>
          <div
            className="details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-details-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button details-modal__close"
              onClick={() => setDetailsOpen(false)}
              aria-label="Close details"
            >
              <X size={20} />
            </button>
            <img src={slide.image} alt="" />
            <div className="details-modal__body">
              <p className="eyebrow">{slide.eyebrow}</p>
              <h2 id="hero-details-title">{slide.title}</h2>
              <p className="details-modal__meta">{slide.meta}</p>
              <div className="hero__tags">
                {slide.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p>{slide.description}</p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => navigate(`/player/${slide.id}`)}
              >
                <Play size={18} fill="currentColor" /> Play now
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
