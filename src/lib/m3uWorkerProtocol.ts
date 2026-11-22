/**
 * Worker message protocol and incremental import session for M3U playlists.
 *
 * The session is transport agnostic: `createImportSession()` only needs a
 * `post()` callback, so the exact same logic runs inside `m3uParser.worker.ts`,
 * inside the inline fallback worker (see `m3uInlineWorker.ts`) and in tests.
 *
 * Protocol (main thread -> worker)
 *   { type: 'start', file, mode, chunkSize, skipChunks, maxEntries }
 *   { type: 'next' }   // acknowledge one chunk; no further chunk is sent until it arrives
 *   { type: 'cancel' }
 *
 * Protocol (worker -> main thread)
 *   { type: 'ready' }
 *   { type: 'progress', parsedEntries, bytesProcessed }
 *   { type: 'chunk', entries }
 *   { type: 'done', total }
 *   { type: 'error', code }
 */

import {
  createIncrementalM3uParser,
  INVALID_PLAYLIST_MESSAGE,
  MAX_TOTAL_ENTRIES,
  PlaylistLimitError,
  type M3uEntry,
} from './m3uParser';

/** Entry count per uploaded chunk; matches the server-side import contract. */
export const DEFAULT_CHUNK_SIZE = 1_000;

/** Minimum delay between progress messages (milliseconds). */
export const PROGRESS_INTERVAL_MS = 200;

/** Time spent parsing between cooperative yields back to the event loop. */
export const PARSE_YIELD_INTERVAL_MS = 100;

/** Text slice size used when a source can only be read as a whole string. */
export const READ_SLICE_CHARS = 256 * 1024;

export type M3uImportErrorCode =
  | 'invalid_playlist'
  | 'entry_limit_exceeded'
  | 'parse_failed'
  | 'file_unreadable'
  | 'bad_request';

export type ImportMode = 'count' | 'stream';

/** Minimal file surface needed by the parser (File and Blob both satisfy it). */
export interface PlaylistSource {
  readonly size?: number;
  text(): Promise<string>;
  stream?(): ReadableStream<Uint8Array>;
}

export type M3uWorkerRequest =
  | {
      type: 'start';
      file: PlaylistSource;
      mode?: ImportMode;
      chunkSize?: number;
      skipChunks?: number;
      maxEntries?: number;
    }
  | { type: 'next' }
  | { type: 'cancel' };

export type M3uWorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; parsedEntries: number; bytesProcessed: number }
  | { type: 'chunk'; entries: M3uEntry[] }
  | { type: 'done'; total: number }
  | { type: 'error'; code: M3uImportErrorCode };

/** Minimal `Worker` surface used by the client and the inline fallback. */
export interface WorkerLike {
  onmessage: ((event: { data: M3uWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: M3uWorkerRequest): void;
  terminate(): void;
}

export interface ReadSlice {
  text: string;
  bytes: number;
}

export interface ImportSessionOptions {
  post: (message: M3uWorkerResponse) => void;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable cooperative yield (tests). */
  yieldToEventLoop?: () => Promise<void>;
  /** Injectable reader (tests). */
  readSource?: (source: PlaylistSource) => AsyncIterable<ReadSlice>;
}

export interface ImportSession {
  handleMessage(message: M3uWorkerRequest): void;
  /** Stop the current run; no further messages are posted. */
  cancel(): void;
  readonly running: boolean;
}

/** Internal marker for a cancelled run (never surfaced as an error). */
class ImportCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ImportCancelled';
  }
}

/** Internal wrapper so parse failures keep their protocol error code. */
export class ImportFailure extends Error {
  constructor(
    public readonly code: M3uImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFailure';
  }
}

function asImportFailure(error: unknown): ImportFailure {
  if (error instanceof ImportFailure) return error;
  if (error instanceof PlaylistLimitError) {
    return new ImportFailure('entry_limit_exceeded', error.message);
  }
  if (error instanceof Error) {
    const code = error.message === INVALID_PLAYLIST_MESSAGE ? 'invalid_playlist' : 'parse_failed';
    return new ImportFailure(code, error.message);
  }
  return new ImportFailure('parse_failed', 'The playlist could not be parsed.');
}

const defaultYield = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Read a playlist as text slices. Prefers `Blob.stream()` so a large file is
 * never materialised as one string; falls back to `text()` sliced by
 * `READ_SLICE_CHARS` when streaming is unavailable.
 */
async function* defaultReadSource(source: PlaylistSource): AsyncGenerator<ReadSlice> {
  if (typeof source.stream === 'function') {
    const reader = source.stream().getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        yield { text: decoder.decode(value, { stream: true }), bytes: value.byteLength };
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader already released by the environment; nothing to clean up.
      }
    }
    const tail = decoder.decode();
    if (tail) yield { text: tail, bytes: 0 };
    return;
  }

  const text = await source.text();
  for (let offset = 0; offset < text.length; offset += READ_SLICE_CHARS) {
    const slice = text.slice(offset, offset + READ_SLICE_CHARS);
    yield { text: slice, bytes: slice.length };
  }
}

export function createImportSession(options: ImportSessionOptions): ImportSession {
  const { post } = options;
  const now = options.now ?? (() => Date.now());
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYield;
  const readSource = options.readSource ?? defaultReadSource;

  let cancelled = false;
  let running = false;
  let nextResolver: (() => void) | null = null;

  function releaseNext(): void {
    const resolve = nextResolver;
    nextResolver = null;
    resolve?.();
  }

  function waitForNext(): Promise<void> {
    if (cancelled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      nextResolver = resolve;
    });
  }

  async function run(request: Extract<M3uWorkerRequest, { type: 'start' }>): Promise<void> {
    const mode: ImportMode = request.mode ?? 'stream';
    const chunkSize = Math.max(1, Math.floor(request.chunkSize ?? DEFAULT_CHUNK_SIZE));
    const skipChunks = Math.max(0, Math.floor(request.skipChunks ?? 0));
    const maxEntries = request.maxEntries ?? MAX_TOTAL_ENTRIES;
    const source = request.file;

    let parser = createIncrementalM3uParser({ maxEntries });
    let pending: M3uEntry[] = [];
    let chunkIndex = 0;
    let parsedEntries = 0;
    let bytesProcessed = 0;
    let lastProgressAt = 0;
    let lastYieldAt = now();

    const ensureActive = () => {
      if (cancelled) throw new ImportCancelled();
    };

    const reportProgress = (force: boolean) => {
      const timestamp = now();
      if (!force && timestamp - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = timestamp;
      post({ type: 'progress', parsedEntries, bytesProcessed });
    };

    /**
     * Emit full chunks and wait for the 'next' acknowledgement between them.
     * This is the backpressure point: the worker stops reading the file while
     * the main thread is still uploading, so memory stays bounded.
     */
    const emitChunks = async () => {
      if (mode !== 'stream') {
        pending = [];
        return;
      }
      while (pending.length >= chunkSize) {
        ensureActive();
        const entries = pending.slice(0, chunkSize);
        pending = pending.slice(chunkSize);
        if (chunkIndex < skipChunks) {
          chunkIndex += 1;
          continue;
        }
        post({ type: 'chunk', entries });
        chunkIndex += 1;
        await waitForNext();
        ensureActive();
      }
    };

    const consume = async (text: string, bytes: number) => {
      bytesProcessed += bytes;
      let produced: M3uEntry[] = [];
      try {
        produced = parser.push(text);
      } catch (error) {
        throw asImportFailure(error);
      }
      parsedEntries = parser.totalEntries;
      if (mode === 'stream') pending.push(...produced);
      await emitChunks();
      reportProgress(mode === 'count');

      const timestamp = now();
      if (timestamp - lastYieldAt >= PARSE_YIELD_INTERVAL_MS) {
        lastYieldAt = timestamp;
        await yieldToEventLoop();
        ensureActive();
      }
    };

    try {
      for await (const slice of readSource(source)) {
        ensureActive();
        await consume(slice.text, slice.bytes);
      }
    } catch (error) {
      if (error instanceof ImportCancelled || error instanceof ImportFailure) throw error;
      if (cancelled) throw new ImportCancelled();
      // Streaming read failed (older browsers, exotic Blob implementations).
      // Restart from scratch with a plain text read: nothing has been emitted
      // to the main thread yet, because chunks are only posted by emitChunks.
      parser = createIncrementalM3uParser({ maxEntries });
      pending = [];
      chunkIndex = 0;
      parsedEntries = 0;
      bytesProcessed = 0;

      let text: string;
      try {
        text = await source.text();
      } catch {
        throw new ImportFailure('file_unreadable', 'The playlist file could not be read.');
      }
      for (let offset = 0; offset < text.length; offset += READ_SLICE_CHARS) {
        ensureActive();
        const slice = text.slice(offset, offset + READ_SLICE_CHARS);
        await consume(slice, slice.length);
      }
    }

    ensureActive();

    let tail: M3uEntry[] = [];
    try {
      tail = parser.finish().entries;
    } catch (error) {
      throw asImportFailure(error);
    }
    parsedEntries = parser.totalEntries;

    if (mode === 'stream') {
      pending.push(...tail);
      if (pending.length > 0) {
        if (chunkIndex >= skipChunks) {
          post({ type: 'chunk', entries: pending });
        }
        pending = [];
      }
    }

    reportProgress(true);
    post({ type: 'done', total: parsedEntries });
  }

  function cancel(): void {
    cancelled = true;
    releaseNext();
  }

  return {
    get running() {
      return running;
    },

    handleMessage(message: M3uWorkerRequest): void {
      switch (message.type) {
        case 'start': {
          if (running || cancelled) {
            post({ type: 'error', code: 'bad_request' });
            return;
          }
          running = true;
          void run(message)
            .catch((error: unknown) => {
              if (cancelled || error instanceof ImportCancelled) return;
              const failure = asImportFailure(error);
              post({ type: 'error', code: failure.code });
            })
            .finally(() => {
              running = false;
            });
          return;
        }
        case 'next': {
          releaseNext();
          return;
        }
        case 'cancel': {
          cancel();
          return;
        }
        default:
          return;
      }
    },

    cancel,
  };
}
