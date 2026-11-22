import { Link } from 'react-router-dom';
import { MonitorPlay, Palette, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { usePreferences } from '../../state/PreferencesContext';
import { useAuth } from '../../state/AuthContext';
import type { Preferences } from '../../types/domain';
import { ProvidersSection } from './ProvidersSection';

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function SelectRow<K extends keyof Preferences>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: K;
  options: { label: string; value: Preferences[K] }[];
  onChange: (key: K, value: Preferences[K]) => void;
}) {
  const { preferences } = usePreferences();
  return (
    <label className="setting-row setting-row--select">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <select value={String(preferences[value])} onChange={(event) => onChange(value, event.target.value as Preferences[K])}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsPage() {
  const { preferences, update, reset } = usePreferences();
  const { status, user } = useAuth();

  return (
    <div className="inner-page settings-page">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Manage your IPTV providers and tailor the interface to this device."
      />

      <section className="settings-section" aria-labelledby="settings-interface">
        <h2 id="settings-interface">
          <Palette size={19} /> Interface
        </h2>
        <div className="settings-card">
          <Toggle
            label="Expand sidebar by default"
            description="Ctrl + \\ toggles the sidebar at any time."
            checked={!preferences.sidebarCollapsed}
            onChange={(value) => update('sidebarCollapsed', !value)}
          />
          <Toggle
            label="TV / 10-foot mode"
            description="Larger controls and D-pad spatial focus navigation."
            checked={preferences.tvMode}
            onChange={(value) => update('tvMode', value)}
          />
          <details className="settings-advanced">
            <summary>Advanced interface options</summary>
            <SelectRow
              label="Density"
              description="How much information fits on screen."
              value="density"
              options={[
                { label: 'Comfortable', value: 'comfortable' },
                { label: 'Compact', value: 'compact' },
              ]}
              onChange={update}
            />
            <SelectRow
              label="Motion"
              description="Respect reduced-motion preferences."
              value="motion"
              options={[
                { label: 'Full', value: 'full' },
                { label: 'Reduced', value: 'reduced' },
              ]}
              onChange={update}
            />
          </details>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-playback">
        <h2 id="settings-playback">
          <MonitorPlay size={19} /> Playback preferences
        </h2>
        <div className="settings-card">
          <p className="settings-card__note">
            The player honours these choices for HLS streams. HLS.js is loaded on demand and MP4 files
            always use the browser's native pipeline; the in-player menu can override the engine for
            the current stream.
          </p>
          <SelectRow
            label="Preferred player"
            description="Auto uses the browser's native player for HLS and falls back to hls.js only when needed."
            value="preferredPlayer"
            options={[
              { label: 'Auto', value: 'auto' },
              { label: 'Native HTML5', value: 'native' },
              { label: 'HLS.js', value: 'hls' },
            ]}
            onChange={update}
          />
          <Toggle
            label="Autoplay"
            description="Start playback when a title is opened."
            checked={preferences.autoplay}
            onChange={(value) => update('autoplay', value)}
          />
          <details className="settings-advanced">
            <summary>Advanced playback</summary>
            <SelectRow
              label="Fallback player"
              value="fallbackPlayer"
              options={[
                { label: 'Auto', value: 'auto' },
                { label: 'Native HTML5', value: 'native' },
                { label: 'HLS.js', value: 'hls' },
              ]}
              onChange={update}
            />
            <Toggle
              label="Auto reconnect"
              description="Recover stalled streams with capped exponential backoff."
              checked={preferences.autoReconnect}
              onChange={(value) => update('autoReconnect', value)}
            />
          </details>
        </div>
      </section>

      <ProvidersSection />

      <section className="settings-section" aria-labelledby="settings-sources">
        <h2 id="settings-sources">
          <ShieldCheck size={19} /> Account & privacy
        </h2>
        <div className="settings-card">
          <div className="setting-row setting-row--link">
            <span>
              <strong>Profile & devices</strong>
              <small>
                {status === 'authenticated' && user
                  ? `Signed in as ${user.email}`
                  : 'Register, sessions and friendly device names.'}
              </small>
            </span>
            <Link to="/profile" className="button button--ghost">
              {status === 'authenticated' ? 'Open profile' : 'Sign in'}
            </Link>
          </div>
          <div className="setting-row setting-row--link">
            <span>
              <strong><ShieldCheck size={16} /> Privacy</strong>
              <small>Streams play directly from your provider. Veyro never relays video traffic.</small>
            </span>
            <span className="setting-row__value">Direct playback</span>
          </div>
        </div>
      </section>

      <button type="button" className="button button--quiet settings-reset" onClick={reset}>
        <SlidersHorizontal size={16} /> Reset local preferences
      </button>
    </div>
  );
}
