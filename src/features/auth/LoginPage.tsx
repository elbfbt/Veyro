import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../state/AuthContext';
import { ApiError } from '../../lib/api';

export function LoginPage() {
  const { status, login, requestPasswordReset, bootError } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to={next} replace />;

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status">
        <span className="auth-loading__spinner" aria-hidden="true" />
        Checking your session…
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password, deviceName });
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResetMessage(null);
    try {
      setResetMessage(await requestPasswordReset(email));
    } catch (cause) {
      setResetMessage(cause instanceof Error ? cause.message : 'Could not request a reset link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to Veyro"
      description="Your playlists, preferences and devices stay tied to your account — never to a third-party content provider."
      footer={
        <>
          New to Veyro? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {(bootError || error) && (
        <div className="auth-alert" role="alert">
          {error ?? bootError}
        </div>
      )}
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>Email address</span>
          <span className="field__control">
            <Mail size={17} aria-hidden="true" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </span>
        </label>
        <label className="field">
          <span>Password</span>
          <span className="field__control">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="At least 10 characters"
              minLength={10}
              required
            />
            <button
              type="button"
              className="field__toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        <label className="field">
          <span>Device name <em>(optional)</em></span>
          <input
            type="text"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="Living Room TV"
            maxLength={60}
          />
        </label>
        <div className="auth-form__row">
          <span className="auth-form__hint">Session stays active on this browser for 30 days.</span>
          <button type="button" className="link-button" onClick={() => setResetOpen((current) => !current)}>
            Forgot password?
          </button>
        </div>
        <button type="submit" className="button button--primary auth-form__submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {resetOpen && (
        <form className="auth-reset" onSubmit={submitReset}>
          <p>
            Email delivery is not configured yet. This checks your request without revealing whether an
            account exists, and sends nothing.
          </p>
          <button type="submit" className="button button--ghost" disabled={!email || busy}>
            Request reset link
          </button>
          {resetMessage && <p role="status">{resetMessage}</p>}
        </form>
      )}
    </AuthLayout>
  );
}
