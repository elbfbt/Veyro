import { Radio, Tv } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MediaCard } from '../../components/media/MediaCard';
import { PageHeader } from '../../components/ui/PageHeader';
import { liveChannels } from '../../data/demo';

export function LivePage() {
  const featured = liveChannels[0];

  return (
    <div className="inner-page">
      <PageHeader
        eyebrow="Live television"
        title="Live TV"
        description="A preview of channel and guide layouts. Your own channels appear here after you connect a provider."
      />

      {featured && (
        <section className="live-feature" aria-labelledby="live-feature-title">
          <img src={featured.backdrop ?? featured.image} alt="" loading="lazy" />
          <div className="live-feature__overlay" aria-hidden="true" />
          <div className="live-feature__body">
            <span className="badge badge--live">
              <span className="badge__pulse" /> ON NOW
            </span>
            <h2 id="live-feature-title">{featured.now?.title}</h2>
            <p>
              {featured.title} · {featured.now?.start}–{featured.now?.end}
            </p>
            <p className="live-feature__next">Next: {featured.next?.title} at {featured.next?.start}</p>
            <Link to={`/player/${featured.id}`} className="button button--primary">
              <Radio size={17} /> Tune in
            </Link>
          </div>
        </section>
      )}

      <section className="section-block" aria-labelledby="favorite-channels-heading">
        <div className="section-block__head">
          <h2 id="favorite-channels-heading">Favorite channels</h2>
          <span className="result-count">{liveChannels.length} demo channels</span>
        </div>
        <div className="media-grid">
          {liveChannels.map((channel) => (
            <MediaCard key={channel.id} item={channel} />
          ))}
        </div>
      </section>

      <section className="section-block" aria-labelledby="guide-heading">
        <div className="section-block__head">
          <h2 id="guide-heading">Guide preview</h2>
          <span className="result-count">
            <Tv size={14} aria-hidden="true" /> Full EPG guide planned for Phase 7
          </span>
        </div>
        <div className="guide-preview" role="table" aria-label="Current and next programs">
          <div className="guide-preview__head" role="row">
            <span role="columnheader">Channel</span>
            <span role="columnheader">Now</span>
            <span role="columnheader">Next</span>
          </div>
          {liveChannels.map((channel) => (
            <div className="guide-preview__row" role="row" key={channel.id}>
              <span role="cell">
                <strong>{channel.channelNumber}</strong> {channel.title}
              </span>
              <span role="cell">{channel.now?.title}</span>
              <span role="cell">{channel.next?.title}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
