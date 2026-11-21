import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, FileUp, Link2, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import type { ConnectionTestResult, Provider, ProviderImportStats, ProviderType } from '../../types/providers';

type ActionName = 'test' | 'refresh' | 'default' | 'toggle' | 'delete' | 'save';

interface FormState {
  name: string;
  type: ProviderType;
  url: string;
  serverUrl: string;
  username: string;
  password: string;
  file: File | null;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'm3u_url',
  url: '',
  serverUrl: '',
  username: '',
  password: '',
  file: null,
};

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function formatDate(value: number | null): string {
  if (!value) return 'Never';
  return new Date(value * 1000).toLocaleString();
}

function ImportSummary({ stats }: { stats: ProviderImportStats | null }) {
  if (!stats) return <small>No import has run yet.</small>;
  return (
    <small>
      {stats.totalEntries} entries · {stats.added} added · {stats.updated} updated · {stats.duplicates} duplicates ·{' '}
      {stats.malformed} malformed
    </small>
  );
}

export function ProvidersSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await apiRequest<{ providers: Provider[] }>('/providers');
      setProviders(result.providers);
    } catch (caught) {
      setLoadError(message(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError('');
    setNotice('');
  }

  function startEdit(provider: Provider) {
    setEditingId(provider.id);
    setForm({
      name: provider.name,
      type: provider.type,
      url: provider.playlistUrl ?? '',
      serverUrl: provider.serverUrl ?? '',
      username: provider.xtreamUsername ?? '',
      password: '',
      file: null,
    });
    setShowForm(true);
    setError('');
    setNotice('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy('save');
    setError('');
    setNotice('');
    try {
      if (editingId) {
        const body: Record<string, unknown> = { name: form.name };
        if (form.type === 'm3u_url') body.url = form.url;
        if (form.type === 'xtream') {
          body.serverUrl = form.serverUrl;
          if (form.username) body.username = form.username;
          if (form.password) body.password = form.password;
        }
        await apiRequest(`/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setNotice('Provider updated.');
      } else if (form.type === 'm3u_file') {
        if (!form.file) throw new Error('Choose an M3U file.');
        const data = new FormData();
        data.append('file', form.file);
        data.append('name', form.name || form.file.name);
        await apiRequest('/providers/import', { method: 'POST', body: data });
        setNotice('Playlist imported.');
      } else {
        const body: Record<string, unknown> = { name: form.name, type: form.type };
        if (form.type === 'm3u_url') body.url = form.url;
        if (form.type === 'xtream') {
          body.serverUrl = form.serverUrl;
          body.username = form.username;
          body.password = form.password;
        }
        await apiRequest('/providers', { method: 'POST', body: JSON.stringify(body) });
        setNotice('Provider added. Use Refresh to import its catalogue.');
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the provider.');
    } finally {
      setBusy(null);
    }
  }

  async function act(provider: Provider, action: Exclude<ActionName, 'save'>) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      if (action === 'test') {
        const result = await apiRequest<ConnectionTestResult>(`/providers/${provider.id}/test`, { method: 'POST' });
        setTestResults((current) => ({ ...current, [provider.id]: result }));
      } else if (action === 'refresh') {
        const stats = await apiRequest<ProviderImportStats>(`/providers/${provider.id}/refresh`, { method: 'POST' });
        setNotice(`Imported ${stats.added} new entries.`);
      } else if (action === 'default') {
        await apiRequest(`/providers/${provider.id}/default`, { method: 'POST' });
        setNotice('Default provider updated.');
      } else if (action === 'toggle') {
        await apiRequest(`/providers/${provider.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !provider.enabled }),
        });
        setNotice(provider.enabled ? 'Provider disabled.' : 'Provider enabled.');
      } else {
        await apiRequest(`/providers/${provider.id}`, { method: 'DELETE' });
        setNotice('Provider removed.');
      }
      await load();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-providers" id="providers">
      <h2 id="settings-providers">
        <Link2 size={19} /> Providers
      </h2>
      <div className="settings-card providers-card">
        <p className="settings-card__note">
          Add an M3U URL, upload an M3U file, or use Xtream Codes-style credentials. Passwords are encrypted on the
          server and are never shown again. Veyro imports metadata only — streams play directly from your provider.
        </p>

        {!showForm && (
          <div className="provider-actions provider-actions--top">
            <button type="button" className="button button--primary" onClick={startAdd}>
              Add provider
            </button>
          </div>
        )}

        {showForm && (
          <form className="provider-form" onSubmit={submit}>
            <h3>{editingId ? 'Edit provider' : 'Add provider'}</h3>
            <label className="provider-field">
              <span>Name</span>
              <input required maxLength={80} value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
            </label>
            {!editingId && (
              <label className="provider-field">
                <span>Type</span>
                <select
                  value={form.type}
                  onChange={(event) => updateForm('type', event.target.value as ProviderType)}
                >
                  <option value="m3u_url">M3U URL</option>
                  <option value="xtream">Xtream Codes credentials</option>
                  <option value="m3u_file">M3U file upload</option>
                </select>
              </label>
            )}
            {form.type === 'm3u_url' && (
              <label className="provider-field">
                <span>Playlist URL</span>
                <input
                  required
                  type="url"
                  placeholder="https://provider.example.com/playlist.m3u8"
                  value={form.url}
                  onChange={(event) => updateForm('url', event.target.value)}
                />
              </label>
            )}
            {form.type === 'xtream' && (
              <>
                <label className="provider-field">
                  <span>Server URL</span>
                  <input
                    required
                    type="url"
                    placeholder="https://provider.example.com:8080"
                    value={form.serverUrl}
                    onChange={(event) => updateForm('serverUrl', event.target.value)}
                  />
                </label>
                <label className="provider-field">
                  <span>Username</span>
                  <input required autoComplete="off" value={form.username} onChange={(event) => updateForm('username', event.target.value)} />
                </label>
                <label className="provider-field">
                  <span>Password {editingId && <small>· saved securely — leave blank to keep</small>}</span>
                  <input
                    required={!editingId}
                    type="password"
                    autoComplete="new-password"
                    placeholder={editingId ? '••••••••' : ''}
                    value={form.password}
                    onChange={(event) => updateForm('password', event.target.value)}
                  />
                </label>
              </>
            )}
            {form.type === 'm3u_file' && !editingId && (
              <label className="provider-field">
                <span>Playlist file (.m3u or .m3u8)</span>
                <input
                  required
                  type="file"
                  accept=".m3u,.m3u8,application/vnd.apple.mpegurl,audio/mpegurl"
                  onChange={(event) => updateForm('file', event.target.files?.[0] ?? null)}
                />
              </label>
            )}
            <div className="provider-actions">
              <button type="submit" className="button button--primary" disabled={busy === 'save'}>
                {busy === 'save' ? 'Saving…' : editingId ? 'Save changes' : 'Add provider'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && <p className="provider-message provider-message--error" role="alert">{error}</p>}
        {notice && <p className="provider-message" role="status">{notice}</p>}

        {loading ? (
          <p className="provider-message">Loading providers…</p>
        ) : loadError ? (
          <p className="provider-message provider-message--error" role="alert">{loadError}</p>
        ) : providers.length === 0 ? (
          <p className="provider-message">No providers yet. Add one to import your catalogue.</p>
        ) : (
          <ul className="provider-list">
            {providers.map((provider) => {
              const result = testResults[provider.id];
              return (
                <li className="provider-item" key={provider.id}>
                  <div className="provider-item__head">
                    <strong>{provider.name}</strong>
                    <span className={`badge badge--${provider.enabled ? 'success' : 'neutral'}`}>
                      {provider.status}
                    </span>
                    {provider.isDefault && <span className="badge badge--neutral">Default</span>}
                  </div>
                  <small>
                    {provider.type === 'xtream'
                      ? `Xtream${provider.xtreamUsername ? ` · ${provider.xtreamUsername}` : ''}`
                      : provider.type === 'm3u_file'
                        ? 'M3U file'
                        : 'M3U URL'}
                  </small>
                  {provider.playlistUrl && <small className="provider-item__url">{provider.playlistUrl}</small>}
                  <small>Last refresh: {formatDate(provider.lastRefreshAt)}</small>
                  <ImportSummary stats={provider.lastImport} />
                  {provider.lastError && <small className="provider-item__error">{provider.lastError}</small>}
                  {result && (
                    <small className={result.ok ? 'provider-item__ok' : 'provider-item__error'}>
                      Connection: {result.status}
                    </small>
                  )}
                  <div className="provider-actions">
                    {provider.type !== 'm3u_file' && (
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void act(provider, 'test')}>
                        <Wifi size={15} /> Test
                      </button>
                    )}
                    {provider.type !== 'm3u_file' && (
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void act(provider, 'refresh')}>
                        <RefreshCw size={15} /> Refresh
                      </button>
                    )}
                    {!provider.isDefault && (
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void act(provider, 'default')}>
                        <Check size={15} /> Make default
                      </button>
                    )}
                    <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void act(provider, 'toggle')}>
                      {provider.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => startEdit(provider)}>
                      Edit
                    </button>
                    <button type="button" className="button button--danger" disabled={busy !== null} onClick={() => void act(provider, 'delete')}>
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="provider-helper"><FileUp size={14} /> Uploaded playlists are imported once; upload a new file to update them.</p>
      </div>
    </section>
  );
}
