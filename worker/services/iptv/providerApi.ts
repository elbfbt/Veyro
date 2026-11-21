import { PlaylistFetchError, UpstreamTimeoutError } from './fetchPlaylist';
import { PlaylistLimitError } from './m3uParser';
import { ProviderError, isProviderError } from './providerService';
import { UnsafeUrlError } from './urlSafety';
import { XtreamClientError } from './xtreamClient';
import type {
  ConnectionTestResult,
  ImportProgress,
  ImportStats,
  M3uEntry,
  ProviderView,
  UpdateProviderInput,
  CreateProviderInput,
} from './types';

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
  importInit(
    userId: string,
    name: string,
    totalEntries: number,
    totalChunks: number,
    chunkSize: number,
    fileSize: number,
  ): Promise<{ jobId: string; providerId: string }>;
  importChunk(
    userId: string,
    jobId: string,
    chunkIndex: number,
    entries: M3uEntry[],
  ): Promise<{ chunkIndex: number; status: 'completed' | 'importing'; importedEntries: number }>;
  getImportProgress(userId: string, jobId: string): Promise<ImportProgress>;
  importComplete(userId: string, jobId: string): Promise<ProviderView>;
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

async function importInit(
  request: Request,
  service: ProviderApiService,
  userId: string,
): Promise<Response> {
  const body = await readJson(request);
  const name = stringValue(body.name);
  const totalEntries = typeof body.totalEntries === 'number' ? body.totalEntries : 0;
  const totalChunks = typeof body.totalChunks === 'number' ? body.totalChunks : 0;
  const chunkSize = typeof body.chunkSize === 'number' ? body.chunkSize : 0;
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;

  if (!name) {
    throw new ProviderError('validation_error', 400, 'Provider name is required.');
  }

  const result = await service.importInit(userId, name, totalEntries, totalChunks, chunkSize, fileSize);
  return json({ jobId: result.jobId, providerId: result.providerId }, 201);
}

async function importChunkRoute(
  request: Request,
  service: ProviderApiService,
  userId: string,
  jobId: string,
): Promise<Response> {
  const body = await readJson(request);
  const chunkIndex = typeof body.chunkIndex === 'number' ? body.chunkIndex : -1;
  const entries = Array.isArray(body.entries) ? body.entries : [];

  const result = await service.importChunk(userId, jobId, chunkIndex, entries);
  return json({
    chunkIndex: result.chunkIndex,
    status: result.status,
    importedEntries: result.importedEntries,
  });
}

async function getProgressRoute(
  _request: Request,
  service: ProviderApiService,
  userId: string,
  jobId: string,
): Promise<Response> {
  const progress = await service.getImportProgress(userId, jobId);
  return json({
    jobId: progress.jobId,
    status: progress.status,
    totalEntries: progress.totalEntries,
    importedEntries: progress.importedEntries,
    totalChunks: progress.totalChunks,
    completedChunks: progress.completedChunks,
    percentage: progress.percentage,
    error: progress.error,
    providerId: progress.providerId,
  });
}

async function importCompleteRoute(
  _request: Request,
  service: ProviderApiService,
  userId: string,
  jobId: string,
): Promise<Response> {
  const provider = await service.importComplete(userId, jobId);
  return json({ provider });
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

    if (url.pathname === '/api/providers/import-init' && method === 'POST') {
      return await importInit(request, service, userId);
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 4 && segments[1] === 'providers' && segments[2] === 'import-chunk' && method === 'POST') {
      return await importChunkRoute(request, service, userId, segments[3]!);
    }

    if (segments.length === 5 && segments[1] === 'providers' && segments[2] === 'import' && segments[4] === 'progress' && method === 'GET') {
      return await getProgressRoute(request, service, userId, segments[3]!);
    }

    if (segments.length === 4 && segments[1] === 'providers' && segments[2] === 'import-complete' && method === 'POST') {
      return await importCompleteRoute(request, service, userId, segments[3]!);
    }
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
