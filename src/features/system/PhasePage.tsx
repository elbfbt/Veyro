import { Link } from 'react-router-dom';
import { ArrowLeft, Check, LockKeyhole, type LucideIcon } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';

interface PhasePageProps {
  eyebrow: string;
  title: string;
  description: string;
  phase: string;
  icon: LucideIcon;
  bullets: string[];
  backTo?: string;
}

export function PhasePage({
  eyebrow,
  title,
  description,
  phase,
  icon: Icon,
  bullets,
  backTo = '/',
}: PhasePageProps) {
  return (
    <div className="inner-page phase-page">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="phase-card">
        <div className="phase-card__visual" aria-hidden="true">
          <span className="phase-card__ring" />
          <Icon size={72} strokeWidth={1.3} />
        </div>
        <div className="phase-card__body">
          <span className="phase-badge">
            <LockKeyhole size={14} /> Planned · {phase}
          </span>
          <h2>Designed now, delivered in {phase}</h2>
          <p>
            This route exists so navigation, focus order and layouts are ready. No placeholder form
            pretends to authenticate, pair a device or import a playlist yet.
          </p>
          <ul>
            {bullets.map((bullet) => (
              <li key={bullet}>
                <Check size={16} aria-hidden="true" /> {bullet}
              </li>
            ))}
          </ul>
          <Link to={backTo} className="button button--ghost">
            <ArrowLeft size={17} /> Back to browsing
          </Link>
        </div>
      </div>
    </div>
  );
}
