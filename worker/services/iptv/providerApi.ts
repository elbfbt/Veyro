import { PlaylistFetchError, UpstreamTimeoutError } from './fetchPlaylist';
import { PlaylistLimitError } from './m3uParser';
import { ProviderError, isProviderError } from './providerService';
import { UnsafeUrlError } from './urlSafety';
import { XtreamClientError } from './xtreamClient';
import type { ConnectionTestResult, ImportStats, ProviderView, UpdateProviderInput, CreateProviderInput } from './types';

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface ProviderApiService {
  list(userId: string): Promise<ProviderView[]>;
  get(userId: string, id: string): Promise<ProviderView>;
  create(userId: string, input: CreateProviderInput): Promise<ProviderView>;
  update(userId: string, id: string, input: UpdateProviderInput): Promise<ProviderView>;
  remove(userId: string, id: string): Promise<void>;
  setDefault(userId: string, id: string): Promise<ProviderView>;
  test(userId: string, id: string): Promise<ConnectionTestResult>;
  refresh(userId: string, id: string): Promise<ImportStats>;
  importFile(userId: string, name: string, content: string): Promise<ProviderView>;
}

function errorResponse(error: unknown): Response {
  if (isProviderError(error)) return json({ error: error.code, message: error.message }, error.status);
  if (error instanceof XtreamClientError) return json({ error: error.code, message: error.message }, error.status);
  if (error instanceof UpstreamTimeoutError) return json({ error: 'provider_timeout', message: 'Provider request timed out.' }, 504);
  if (error instanceof UnsafeUrlError) return json({ error: 'unsafe_url', message: 'The URL is not allowed.' }, 400);
  if (error instanceof PlaylistLimitError) return json({ error: 'playlist_too_large', message: error.message }, 413);
  if (error instanceof PlaylistFetchError) return json({ error: 'playlist_fetch_failed', message: 'The playlist could not be retrieved.' }, 502);
  return json({ error: 'internal_error', message: 'The request could not be completed.' }, 500);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await request.text());
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    throw new ProviderError('validation_error', 400, 'Invalid request body.');
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function createInput(body: Record<string, unknown>): CreateProviderInput {
  return {
    name: stringValue(body.name) ?? '',
    type: stringValue(body.type) as CreateProviderInput['type'],
    url: stringValue(body.url),
    serverUrl: stringValue(body.serverUrl),
    username: stringValue(body.username),
    password: stringValue(body.password),
  };
}

function updateInput(body: Record<string, unknown>): UpdateProviderInput {
  return {
    name: stringValue(body.name),
    url: stringValue(body.url),
    serverUrl: stringValue(body.serverUrl),
    username: stringValue(body.username),
    password: stringValue(body.password),
    enabled: boolValue(body.enabled),
  };
}

async function importFile(request: Request, service: ProviderApiService, userId: string): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ProviderError('validation_error', 400, 'Invalid playlist upload.');
  }
  const value = form.get('file');
  const name = stringValue(form.get('name')) ?? (value && typeof value !== 'string' ? value.name : '');
  if (!value || typeof value === 'string' || typeof (value as File).text !== 'function') {
    throw new ProviderError('validation_error', 400, 'Choose an M3U playlist file.');
  }
  const file = value as File;
  if (!/\.m3u8?$/i.test(file.name)) {
    throw new ProviderError('validation_error', 400, 'Choose a .m3u or .m3u8 playlist file.');
  }
  const provider = await service.importFile(userId, name, await file.text());
  return json({ provider, imported: true });
}

/** Returns null for non-provider routes so api.ts can continue routing. */
export async function handleProviderApi(
  request: Request,
  url: URL,
  userId: string,
  service: ProviderApiService,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/providers')) return null;
  const method = request.method.toUpperCase();

  try {
    if (url.pathname === '/api/providers') {
      if (method === 'GET') return json({ providers: await service.list(userId) });
      if (method === 'POST') return json({ provider: await service.create(userId, createInput(await readJson(request))) }, 201);
      return null;
    }

    if (url.pathname === '/api/providers/import' && method === 'POST') {
      return await importFile(request, service, userId);
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 3 || segments[1] !== 'providers') return null;
    const id = segments[2];
    if (!id || id.length > 128) throw new ProviderError('not_found', 404, 'Provider not found.');

    if (segments.length === 3) {
      if (method === 'GET') return json({ provider: await service.get(userId, id) });
      if (method === 'PATCH') return json({ provider: await service.update(userId, id, updateInput(await readJson(request))) });
      if (method === 'DELETE') {
        await service.remove(userId, id);
        return json({ ok: true });
      }
      return null;
    }

    if (segments.length === 4 && method === 'POST') {
      if (segments[3] === 'test') return json(await service.test(userId, id));
      if (segments[3] === 'refresh') return json(await service.refresh(userId, id));
      if (segments[3] === 'default') return json({ provider: await service.setDefault(userId, id) });
    }
    return null;
  } catch (error) {
    return errorResponse(error);
  }
}
