/**
 * Main-thread client for incremental M3U parsing.
 *
 * Parsing happens in a module worker (`m3uParser.worker.ts`); chunks are handed
 * to the caller one at a time and no further chunk is requested until the
 * previous one has been uploaded, which bounds memory for 100,000 entry files.
 *
 * If `Worker` is unavailable, fails to load, or never reports ready, the client
 * transparently falls back to the inline worker (same protocol, incremental
 * parsing on the main thread). Neither path can hang silently.
 */

import {
  INVALID_PLAYLIST_MESSAGE,
  MAX_TOTAL_ENTRIES,
  type M3uEntry,
} from './m3uParser';
import {
  DEFAULT_CHUNK_SIZE,
  type M3uImportErrorCode as WorkerErrorCode,
  type M3uWorkerRequest,
  type M3uWorkerResponse,
  type PlaylistSource,
  type WorkerLike,
} from './m3uWorkerProtocol';
import { createInlineM3uWorker } from './m3uInlineWorker';

/** How long the client waits for the worker's `ready` message. */
export const WORKER_READY_TIMEOUT_MS = 5_000;

export type M3uImportErrorCode = WorkerErrorCode | 'worker_failed' | 'cancelled' | 'chunk_failed';

const ERROR_MESSAGES: Record<M3uImportErrorCode, string> = {
  invalid_playlist: INVALID_PLAYLIST_MESSAGE,
  entry_limit_exceeded: `Playlist exceeds ${MAX_TOTAL_ENTRIES} entry limit.`,
  parse_failed: 'The playlist could not be parsed.',
  file_unreadable: 'The playlist file could not be read.',
  bad_request: 'The playlist import could not be started.',
  worker_failed: 'Playlist parsing stopped unexpectedly. Please try again.',
  cancelled: 'Import cancelled.',
  chunk_failed: 'Upload failed.',
};

export class M3uImportError extends Error {
  constructor(
    public readonly code: M3uImportErrorCode,
    message: string = ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = 'M3uImportError';
  }
}

/** Raised when the worker cannot be created or never becomes ready. */
class WorkerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerStartError';
  }
}

export type M3uFallbackReason = 'unsupported_environment' | 'worker_failed';

export interface M3uImportProgress {
  /** Entries parsed so far, including those not yet uploaded. */
  parsedEntries: number;
  /** Bytes decoded by the parser. */
  bytesProcessed: number;
}

export type WorkerFactory = () => WorkerLike;

/** Factory for the real module worker. */
export function createM3uWorker(): WorkerLike {
  // The `new Worker(new URL(...))` shape must stay inline so Vite can emit and
  // rewrite the worker asset at build time.
  const worker = new Worker(new URL('./m3uParser.worker.ts', import.meta.url), {
    type: 'module',
  });
  return worker as unknown as WorkerLike;
}

/** Normalise upload failures so the UI can show the underlying reason. */
function asChunkError(error: unknown): M3uImportError {
  if (error instanceof M3uImportError) return error;
  if (error instanceof Error && error.message) return new M3uImportError('chunk_failed', error.message);
  return new M3uImportError('chunk_failed');
}

interface RunOptions {
  file: PlaylistSource;
  mode: 'count' | 'stream';
  chunkSize: number;
  skipChunks: number;
  maxEntries: number;
  signal?: AbortSignal;
  onProgress?: (progress: M3uImportProgress) => void;
  onChunk?: (entries: M3uEntry[], chunkIndex: number) => Promise<void> | void;
  onFallback?: (reason: M3uFallbackReason) => void;
  workerFactory?: WorkerFactory;
}

/**
 * Run one import session against a worker-like transport. Resolves with the
 * total number of parsed entries; terminates the worker on every exit path.
 */
function runSession(worker: WorkerLike, options: RunOptions): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let ready = false;
    let deliveredChunks = 0;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (total: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(total);
    };

    function onAbort() {
      fail(new M3uImportError('cancelled'));
    }

    if (options.signal?.aborted) {
      fail(new M3uImportError('cancelled'));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    worker.onerror = () => {
      fail(ready ? new M3uImportError('worker_failed') : new WorkerStartError('worker error'));
    };

    worker.onmessage = (event) => {
      if (settled) return;
      const message: M3uWorkerResponse = event.data;

      switch (message.type) {
        case 'ready': {
          ready = true;
          if (readyTimer !== null) {
            clearTimeout(readyTimer);
            readyTimer = null;
          }
          try {
            worker.postMessage({
              type: 'start',
              file: options.file,
              mode: options.mode,
              chunkSize: options.chunkSize,
              skipChunks: options.skipChunks,
              maxEntries: options.maxEntries,
            } satisfies M3uWorkerRequest);
          } catch {
            fail(new M3uImportError('worker_failed'));
          }
          return;
        }
        case 'progress': {
          options.onProgress?.({
            parsedEntries: message.parsedEntries,
            bytesProcessed: message.bytesProcessed,
          });
          return;
        }
        case 'chunk': {
          // Absolute index: the worker skipped the chunks D1 already has, so the
          // first delivered chunk continues numbering after `skipChunks`.
          const chunkIndex = options.skipChunks + deliveredChunks;
          deliveredChunks += 1;
          let uploaded: Promise<void> | void;
          try {
            uploaded = options.onChunk?.(message.entries, chunkIndex);
          } catch (error) {
            fail(asChunkError(error));
            return;
          }
          Promise.resolve(uploaded)
            .then(() => {
              if (settled) return;
              worker.postMessage({ type: 'next' });
            })
            .catch((error: unknown) => {
              fail(asChunkError(error));
            });
          return;
        }
        case 'done': {
          succeed(message.total);
          return;
        }
        case 'error': {
          fail(new M3uImportError(message.code));
          return;
        }
        default:
          return;
      }
    };

    readyTimer = setTimeout(() => {
      if (ready || settled) return;
      fail(new WorkerStartError('worker did not become ready'));
    }, WORKER_READY_TIMEOUT_MS);
  });
}

async function runImport(options: RunOptions): Promise<number> {
  const canUseWorker = options.workerFactory !== undefined || typeof Worker !== 'undefined';

  if (!canUseWorker) {
    options.onFallback?.('unsupported_environment');
    return runSession(createInlineM3uWorker(), options);
  }

  const factory = options.workerFactory ?? createM3uWorker;
  let worker: WorkerLike;
  try {
    worker = factory();
  } catch {
    options.onFallback?.('worker_failed');
    return runSession(createInlineM3uWorker(), options);
  }

  try {
    return await runSession(worker, options);
  } catch (error) {
    // A worker that never loaded has not emitted anything yet, so retrying on
    // the inline worker cannot duplicate an upload.
    if (error instanceof WorkerStartError) {
      options.onFallback?.('worker_failed');
      return runSession(createInlineM3uWorker(), options);
    }
    throw error;
  }
}

export interface CountOptions {
  signal?: AbortSignal;
  onProgress?: (progress: M3uImportProgress) => void;
  onFallback?: (reason: M3uFallbackReason) => void;
  workerFactory?: WorkerFactory;
  /** Entry cap; defaults to MAX_TOTAL_ENTRIES. */
  maxEntries?: number;
}

/** Count the playable entries in a playlist without retaining them. */
export async function countPlaylistEntries(
  file: PlaylistSource,
  options: CountOptions = {},
): Promise<number> {
  return runImport({
    file,
    mode: 'count',
    chunkSize: DEFAULT_CHUNK_SIZE,
    skipChunks: 0,
    maxEntries: options.maxEntries ?? MAX_TOTAL_ENTRIES,
    signal: options.signal,
    onProgress: options.onProgress,
    onFallback: options.onFallback,
    workerFactory: options.workerFactory,
  });
}

export interface StreamOptions extends CountOptions {
  /** Entries per chunk; defaults to DEFAULT_CHUNK_SIZE (1,000). */
  chunkSize?: number;
  /** Chunks already uploaded by a previous run (resume). */
  skipChunks?: number;
  /** Upload one chunk; the next chunk waits for this promise to settle. */
  onChunk: (entries: M3uEntry[], chunkIndex: number) => Promise<void> | void;
}

/**
 * Stream playlist entries as chunks, one upload at a time. Resolves with the
 * total number of entries in the playlist once every chunk has been delivered.
 */
export async function streamPlaylistChunks(
  file: PlaylistSource,
  options: StreamOptions,
): Promise<number> {
  return runImport({
    file,
    mode: 'stream',
    chunkSize: Math.max(1, Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE)),
    skipChunks: Math.max(0, Math.floor(options.skipChunks ?? 0)),
    maxEntries: options.maxEntries ?? MAX_TOTAL_ENTRIES,
    signal: options.signal,
    onProgress: options.onProgress,
    onChunk: options.onChunk,
    onFallback: options.onFallback,
    workerFactory: options.workerFactory,
  });
}
