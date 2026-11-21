import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../state/AuthContext';
import { ApiError } from '../../lib/api';

export function RegisterPage() {
  const { status, register, bootError } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await register({ displayName, email, password, deviceName });
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Get started"
      title="Create your account"
      description="A free account keeps your favorites, watchlist and settings ready for every device you use."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
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
          <span>Display name <em>(optional)</em></span>
          <span className="field__control">
            <UserRound size={17} aria-hidden="true" />
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              placeholder="Alex"
              maxLength={80}
            />
          </span>
        </label>
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
              autoComplete="new-password"
              placeholder="At least 10 characters"
              minLength={10}
              maxLength={128}
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
          <span>Confirm password</span>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
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
        <button type="submit" className="button button--primary auth-form__submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth-form__fineprint">
          Use a password you do not share with your IPTV provider. Veyro never needs your provider
          password to manage your account.
        </p>
      </form>
    </AuthLayout>
  );
}
