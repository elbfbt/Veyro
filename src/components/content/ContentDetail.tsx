import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, ShieldCheck } from 'lucide-react';
import { contentMeta } from '../../lib/content';
import type { ContentKind } from '../../types/content';
import { SafeArtwork } from './SafeArtwork';

interface ContentDetailProps {
  eyebrow: string;
  title: string;
  description: string | null;
  art: string | null;
  category: string | null;
  provider: string;
  meta: Array<string | number | null | undefined>;
  backTo: string;
  backLabel: string;
  kind?: ContentKind;
  contentId?: string;
  children?: ReactNode;
}

export function ContentDetail({
  eyebrow,
  title,
  description,
  art,
  category,
  provider,
  meta,
  backTo,
  backLabel,
  kind,
  contentId,
  children,
}: ContentDetailProps) {
  const navigate = useNavigate();

  const handlePlay = () => {
    if (!kind || !contentId) return;
    navigate(`/player/${kind}/${encodeURIComponent(contentId)}`);
  };
  return (
    <div className="inner-page content-detail-page">
      <Link to={backTo} className="button button--quiet detail-back" data-spatial="detail-back">
        <ArrowLeft size={18} /> {backLabel}
      </Link>
      <section className="content-detail">
        <div className="content-detail__art">
          <SafeArtwork src={art} alt="" eager />
        </div>
        <div className="content-detail__body">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="content-detail__meta">{contentMeta([category, provider, ...meta])}</p>
          {description && <p className="content-detail__description">{description}</p>}
          <div className="content-detail__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={handlePlay}
              data-spatial="detail-play"
              disabled={!kind || !contentId}
            >
              <Play size={18} /> Play
            </button>
          </div>
          <p className="content-detail__privacy">
            <ShieldCheck size={15} /> Streams are resolved only when playback ships. Veyro never relays video.
          </p>
        </div>
      </section>
      {children}
    </div>
  );
}
