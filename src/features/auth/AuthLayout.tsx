import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { brand } from '../../brand/config';

interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({ eyebrow, title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-page">
      <aside className="auth-page__visual" aria-hidden="true">
        <img src="/media/hero-transmission.jpg" alt="" />
        <div className="auth-page__visual-shade" />
        <div className="auth-page__visual-content">
          <p className="eyebrow">{brand.wordmark} · Client</p>
          <h2>Your screen.<br />Your source.</h2>
          <p>
            One secure account for your playlists, preferences and devices — across browser, phone
            and future TV apps.
          </p>
          <span className="auth-page__privacy">
            <ShieldCheck size={16} /> Direct provider-to-device playback. No video relay.
          </span>
        </div>
      </aside>

      <section className="auth-page__panel">
        <div className="auth-card">
          <Link to="/" className="auth-card__back">
            ← Back to browsing
          </Link>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-card__description">{description}</p>
          {children}
          <div className="auth-card__footer">{footer}</div>
        </div>
      </section>
    </div>
  );
}
