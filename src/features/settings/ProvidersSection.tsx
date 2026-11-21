import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, FileUp, Link2, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { ApiError, apiRequest, importComplete, importChunk, importInit, getImportProgress } from '../../lib/api';
import { parseM3u, type M3uEntry } from '../../lib/m3uParser';
import type { ConnectionTestResult, Provider, ProviderImportStats, ProviderType } from '../../types/providers';

type ActionName = 'test' | 'refresh' | 'default' | 'toggle' | 'save' | 'import' | 'delete';

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

type ImportPhase = 'idle' | 'selecting' | 'parsing' | 'preview' | 'initializing' | 'uploading' | 'completed' | 'failed';

interface ChunkedImportState {
  phase: ImportPhase;
  file: File | null;
  entries: M3uEntry[] | null;
  totalEntries: number;
  totalChunks: number;
  currentChunk: number;
  importedEntries: number;
  percentage: number;
  error: string | null;
  retries: number; // retries for the current chunk (max 3)
  jobId: string | null;
  providerId: string | null;
}

const EMPTY_IMPORT: ChunkedImportState = {
  phase: 'idle',
  file: null,
  entries: null,
  totalEntries: 0,
  totalChunks: 0,
  currentChunk: 0,
  importedEntries: 0,
  percentage: 0,
  error: null,
  retries: 0,
  jobId: null,
  providerId: null,
};

const CHUNK_SIZE = 1000;
const MAX_RETRIES = 3;

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

  const [importState, setImportState] = useState<ChunkedImportState>(EMPTY_IMPORT);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      } else if (action === 'import') {
        // Trigger chunked import for this provider's file — handled by import UI
        setNotice('Use the chunked import button to upload a playlist file.');
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

  /* ── Chunked import ─────────────────────────────────────────── */

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    if (!/\.m3u8?$/i.test(file.name)) {
      setError('Choose a .m3u or .m3u8 playlist file.');
      return;
    }
    setImportState((current) => ({ ...current, phase: 'selecting', file, error: null }));
    setError('');
    setNotice('');
  }

  async function parseFile() {
    const file = importState.file;
    if (!file) return;

    setImportState((current) => ({ ...current, phase: 'parsing', error: null }));

    try {
      const text = await file.text();
      const parsed = parseM3u(text);
      const entries = parsed.entries;
      const totalChunks = Math.ceil(entries.length / CHUNK_SIZE);

      setImportState((current) => ({
        ...current,
        phase: 'preview',
        entries,
        totalEntries: entries.length,
        totalChunks,
        currentChunk: 0,
        importedEntries: 0,
        percentage: 0,
      }));
    } catch (caught) {
      setImportState((current) => ({ ...current, phase: 'failed', error: message(caught) }));
      setError(caught instanceof Error ? caught.message : 'Failed to parse playlist.');
    }
  }

  async function startChunkedImport() {
    const { file, entries } = importState;
    if (!file || !entries) return;

    setBusy('import');
    setError('');
    setNotice('');

    try {
      setImportState((current) => ({ ...current, phase: 'initializing', error: null }));

      const providerName = form.name.trim() || file.name.replace(/\.m3u8?$/i, '');
      const totalEntries = entries.length;
      const totalChunks = Math.ceil(totalEntries / CHUNK_SIZE);

      const { jobId, providerId } = await importInit({
        name: providerName,
        totalEntries,
        totalChunks,
        chunkSize: CHUNK_SIZE,
        fileSize: file.size,
      });

      setImportState((current) => ({
        ...current,
        phase: 'uploading',
        jobId,
        providerId,
        totalEntries,
        totalChunks,
      }));

      await uploadChunks(entries, jobId);
    } catch (caught) {
      setImportState((current) => ({ ...current, phase: 'failed', error: message(caught) }));
      setError(caught instanceof Error ? caught.message : 'Import failed.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadChunks(entries: M3uEntry[], jobId: string) {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let { currentChunk, importedEntries, retries } = importState;

    while (currentChunk < importState.totalChunks!) {
      if (controller.signal.aborted) return;

      const chunkEntries = entries.slice(currentChunk * CHUNK_SIZE, (currentChunk + 1) * CHUNK_SIZE);

      try {
        const result = await importChunk(jobId, { chunkIndex: currentChunk, entries: chunkEntries });

        importedEntries = result.importedEntries;
        const percentage = Math.round((importedEntries / importState.totalEntries!) * 100);

        setImportState((current) => ({
          ...current,
          currentChunk: currentChunk + 1,
          importedEntries,
          percentage,
          retries: 0,
          error: null,
        }));

        currentChunk++;
      } catch (caught) {
        if (retries >= MAX_RETRIES) {
          setImportState((current) => ({
            ...current,
            phase: 'failed',
            error: `Chunk ${currentChunk + 1} failed after ${MAX_RETRIES} retries.`,
          }));
          setError(`Chunk ${currentChunk + 1} failed after ${MAX_RETRIES} retries.`);
          return;
        }

        retries++;
        setImportState((current) => ({ ...current, retries }));
        // Small delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      }
    }

    // All chunks uploaded — mark complete
    try {
      const { provider } = await importComplete(jobId);
      setImportState((current) => ({
        ...current,
        phase: 'completed',
        currentChunk: importState.totalChunks,
        percentage: 100,
      }));
      setNotice(`Playlist imported as "${provider.name}" (${importState.totalEntries} entries).`);
      await load();
    } catch (caught) {
      setImportState((current) => ({ ...current, phase: 'failed', error: message(caught) }));
      setError(caught instanceof Error ? caught.message : 'Failed to finalize import.');
    }
  }

  async function resumeImport() {
    const { jobId } = importState;
    if (!jobId) return;

    setBusy('import');
    setError('');

    try {
      // Fetch authoritative progress from D1
      const progress = await getImportProgress(jobId);

      if (progress.status === 'completed') {
        const { provider } = await importComplete(jobId);
        setImportState((current) => ({
          ...current,
          phase: 'completed',
          currentChunk: progress.completedChunks,
          importedEntries: progress.importedEntries,
          percentage: progress.percentage,
          providerId: progress.providerId,
        }));
        setNotice(`Import already completed: "${provider.name}".`);
        await load();
        return;
      }

      if (progress.status === 'failed') {
        setImportState((current) => ({ ...current, phase: 'failed', error: progress.error ?? 'Import failed.' }));
        return;
      }

      // Resume from completed_chunks
      const entries = importState.entries!;
      setImportState((current) => ({
        ...current,
        phase: 'uploading',
        currentChunk: progress.completedChunks,
        importedEntries: progress.importedEntries,
        percentage: progress.percentage,
        retries: 0,
      }));

      await uploadChunks(entries, jobId);
    } catch (caught) {
      setImportState((current) => ({ ...current, phase: 'failed', error: message(caught) }));
      setError(caught instanceof Error ? caught.message : 'Resume failed.');
    } finally {
      setBusy(null);
    }
  }

  function cancelImport() {
    abortControllerRef.current?.abort();
    setImportState(EMPTY_IMPORT);
    setError('');
    setNotice('Import cancelled.');
  }

  /* ── Render ─────────────────────────────────────────────────── */

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

        {!showForm && importState.phase === 'idle' && (
          <div className="provider-actions provider-actions--top">
            <button type="button" className="button button--primary" onClick={startAdd}>
              Add provider
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setImportState((current) => ({ ...current, phase: 'selecting', error: null }));
                setError('');
                setNotice('');
              }}
            >
              Import M3U file (chunked)
            </button>
          </div>
        )}

        {showForm && (
          <form className="provider-form" onSubmit={submit}>
            <h3>{editingId ? 'Edit provider' : 'Add provider'}</h3>
            <label className="provider-field">
              <span>Name</span>
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
              />
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
                  <input
                    required
                    autoComplete="off"
                    value={form.username}
                    onChange={(event) => updateForm('username', event.target.value)}
                  />
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

        {importState.phase !== 'idle' && importState.phase !== 'completed' && importState.phase !== 'failed' && (
          <div className="provider-form">
            <h3>Import M3U Playlist</h3>

            {importState.phase === 'selecting' && (
              <>
                {importState.file && (
                  <p>
                    Selected: <strong>{importState.file.name}</strong> ({Math.round(importState.file.size / 1024)} KB)
                  </p>
                )}
                <input
                  type="file"
                  accept=".m3u,.m3u8"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <div className="provider-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.m3u,.m3u8';
                      input.onchange = (event) => handleFileSelect(event as unknown as React.ChangeEvent<HTMLInputElement>);
                      input.click();
                    }}
                  >
                    Choose file
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={parseFile}
                    disabled={!importState.file}
                  >
                    Parse playlist
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => {
                      setImportState(EMPTY_IMPORT);
                      setError('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {importState.phase === 'parsing' && (
              <>
                <p>Parsing playlist…</p>
                <button type="button" className="button button--ghost" onClick={cancelImport}>
                  Cancel
                </button>
              </>
            )}

            {importState.phase === 'preview' && importState.entries && (
              <>
                <p>
                  Parsed <strong>{importState.totalEntries}</strong> entries in{' '}
                  <strong>{importState.totalChunks}</strong> chunk{importState.totalChunks !== 1 ? 's' : ''}
                  (up to {CHUNK_SIZE} per chunk).
                </p>
                <div className="provider-actions">
                  <button type="button" className="button button--primary" onClick={startChunkedImport}>
                    Start import
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setImportState(EMPTY_IMPORT)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {importState.phase === 'initializing' && (
              <>
                <p>Initializing import job…</p>
                <button type="button" className="button button--ghost" onClick={cancelImport}>
                  Cancel
                </button>
              </>
            )}

            {importState.phase === 'uploading' && (
              <>
                <p>
                  Uploading chunk <strong>{importState.currentChunk + 1} / {importState.totalChunks}</strong>
                  ({importState.importedEntries} / {importState.totalEntries} entries)
                </p>
                {importState.percentage > 0 && (
                  <div className="progress-bar">
                    <div
                      className="progress-bar__fill"
                      style={{ width: `${importState.percentage}%` }}
                    />
                  </div>
                )}
                {importState.retries > 0 && (
                  <p className="provider-message">
                    Retrying chunk {importState.currentChunk + 1} (attempt {importState.retries} / {MAX_RETRIES})...
                  </p>
                )}
                <div className="provider-actions">
                  <button type="button" className="button button--danger" onClick={cancelImport}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {importState.phase === 'failed' && (
          <div className="provider-form">
            <h3>Import failed</h3>
            <p className="provider-message provider-message--error" role="alert">
              {importState.error}
            </p>
            {importState.jobId && (
              <div className="provider-actions">
                <button type="button" className="button button--primary" onClick={resumeImport}>
                  Resume import
                </button>
                <button type="button" className="button button--ghost" onClick={cancelImport}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {importState.phase === 'completed' && (
          <div className="provider-form">
            <h3>Import complete</h3>
            <p>
              Successfully imported <strong>{importState.totalEntries}</strong> entries as a new provider.
            </p>
            <div className="provider-actions">
              <button type="button" className="button button--primary" onClick={cancelImport}>
                Done
              </button>
            </div>
          </div>
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
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy !== null}
                        onClick={() => void act(provider, 'test')}
                      >
                        <Wifi size={15} /> Test
                      </button>
                    )}
                    {provider.type !== 'm3u_file' && (
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy !== null}
                        onClick={() => void act(provider, 'refresh')}
                      >
                        <RefreshCw size={15} /> Refresh
                      </button>
                    )}
                    {!provider.isDefault && (
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy !== null}
                        onClick={() => void act(provider, 'default')}
                      >
                        <Check size={15} /> Make default
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busy !== null}
                      onClick={() => void act(provider, 'toggle')}
                    >
                      {provider.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busy !== null}
                      onClick={() => startEdit(provider)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={busy !== null}
                      onClick={() => void act(provider, 'delete')}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="provider-helper">
          <FileUp size={14} /> Uploaded playlists are imported once; upload a new file to update them.
        </p>
      </div>
    </section>
  );
}
