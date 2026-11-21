import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Monitor, ShieldCheck, Smartphone, Trash2, Tv } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../state/AuthContext';
import type { DeviceView, SessionView } from '../../types/auth';

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function platformIcon(platform: string) {
  if (platform === 'android_tv') return <Tv size={18} />;
  if (platform === 'phone' || platform === 'android') return <Smartphone size={18} />;
  return <Monitor size={18} />;
}

export function ProfilePage() {
  const { status, user, bootError, logout, listSessions, revokeSession, listDevices } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    Promise.all([listSessions(), listDevices()])
      .then(([nextSessions, nextDevices]) => {
        if (cancelled) return;
        setSessions(nextSessions);
        setDevices(nextDevices);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load account details.');
      });
    return () => {
      cancelled = true;
    };
  }, [status, listSessions, listDevices]);

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status">
        <span className="auth-loading__spinner" aria-hidden="true" />
        Checking your session…
      </div>
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <div className="inner-page">
        <PageHeader
          eyebrow="Account"
          title="Profile"
          description="Sign in to access your sessions, devices and cross-device preferences."
        />
        <div className="profile-empty">
          <h2>You are browsing as a guest</h2>
          <p>Demo favorites and preferences stay on this device until you create an account.</p>
          {bootError && <div className="auth-alert" role="alert">{bootError}</div>}
          <div className="profile-empty__actions">
            <Link className="button button--primary" to="/login?next=%2Fprofile">
              Sign in
            </Link>
            <Link className="button button--ghost" to="/register?next=%2Fprofile">
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (session: SessionView) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revokeSession(session.id);
      setSessions((current) => current.filter((entry) => entry.id !== session.id));
      setNotice(session.current ? 'Current session signed out.' : 'Session revoked.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inner-page profile-page">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Your Veyro account is separate from any IPTV provider you connect later."
        actions={
          <button type="button" className="button button--ghost" onClick={signOut} disabled={busy}>
            <LogOut size={17} /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        }
      />

      {(error || notice) && (
        <div className={error ? 'auth-alert' : 'auth-notice'} role={error ? 'alert' : 'status'}>
          {error ?? notice}
        </div>
      )}

      <section className="profile-card" aria-label="Account details">
        <div className="profile-card__avatar" aria-hidden="true">
          {user.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h2>{user.displayName}</h2>
          <p>{user.email}</p>
          <p className="profile-card__meta">Member since {formatDate(user.createdAt)}</p>
        </div>
        <span className="badge badge--neutral">
          <ShieldCheck size={14} /> Secure session
        </span>
      </section>

      <section className="section-block" aria-labelledby="profile-sessions">
        <div className="section-block__head">
          <h2 id="profile-sessions">Active sessions</h2>
          <span className="result-count">{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
        </div>
        <div className="profile-list">
          {sessions.map((session) => (
            <div className="profile-list__row" key={session.id}>
              <Monitor size={18} aria-hidden="true" />
              <div>
                <strong>
                  {session.current ? 'This browser' : `Session ${session.id.slice(0, 8)}`}
                  {session.current && <span className="profile-list__current">Current</span>}
                </strong>
                <small>
                  Last seen {formatDate(session.lastSeenAt)} · Expires {formatDate(session.expiresAt)}
                </small>
              </div>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => revoke(session)}
                disabled={busy}
                aria-label={session.current ? 'Sign out of current session' : 'Revoke session'}
              >
                <Trash2 size={16} /> {session.current ? 'Sign out' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block" aria-labelledby="profile-devices">
        <div className="section-block__head">
          <h2 id="profile-devices">Devices</h2>
          <span className="result-count">Ready for future native apps</span>
        </div>
        <div className="profile-list">
          {devices.map((device) => (
            <div className="profile-list__row" key={device.id}>
              {platformIcon(device.platform)}
              <div>
                <strong>{device.name}</strong>
                <small>{device.platform.replace('_', ' ')} · Last seen {formatDate(device.lastSeenAt)}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block" aria-labelledby="profile-reset">
        <div className="section-block__head">
          <h2 id="profile-reset">Password reset</h2>
        </div>
        <div className="profile-note">
          Password reset links require an email delivery provider. The request endpoint is in place and
          returns a generic response; confirmation remains unavailable until that infrastructure is added.
        </div>
      </section>
    </div>
  );
}
