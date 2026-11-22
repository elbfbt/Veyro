import { describe, expect, it, vi } from 'vitest';
import {
  countPlaylistEntries,
  createM3uWorker,
  M3uImportError,
  streamPlaylistChunks,
  WORKER_READY_TIMEOUT_MS,
  type WorkerFactory,
} from '../src/lib/m3uImportClient';
import { createInlineM3uWorker } from '../src/lib/m3uInlineWorker';
import type { M3uWorkerRequest, WorkerLike } from '../src/lib/m3uWorkerProtocol';

function playlist(count: number): string {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < count; index += 1) {
    lines.push(`#EXTINF:-1 tvg-id="ch-${index}",Channel ${index}`);
    lines.push(`https://stream.test/${index}.m3u8`);
  }
  return lines.join('\n');
}

function file(content: string): File {
  return new File([content], 'playlist.m3u', { type: 'application/vnd.apple.mpegurl' });
}

interface WrappedWorker {
  worker: WorkerLike;
  terminate: ReturnType<typeof vi.fn>;
  sent: M3uWorkerRequest[];
}

/** Wraps the inline worker so tests can observe termination and messages. */
function wrapInlineWorker(): WrappedWorker {
  const inner = createInlineM3uWorker();
  const sent: M3uWorkerRequest[] = [];
  const terminate = vi.fn(() => inner.terminate());
  const worker: WorkerLike = {
    get onmessage() {
      return inner.onmessage;
    },
    set onmessage(handler) {
      inner.onmessage = handler;
    },
    get onerror() {
      return inner.onerror;
    },
    set onerror(handler) {
      inner.onerror = handler;
    },
    postMessage(message) {
      sent.push(message);
      inner.postMessage(message);
    },
    terminate,
  };
  return { worker, terminate, sent };
}

describe('countPlaylistEntries', () => {
  it('counts entries through an injected worker', async () => {
    const { worker, terminate } = wrapInlineWorker();
    const progress: number[] = [];

    const total = await countPlaylistEntries(file(playlist(1_500)), {
      workerFactory: () => worker,
      onProgress: (update) => progress.push(update.parsedEntries),
    });

    expect(total).toBe(1_500);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1_500);
    // The worker is always released, on success as well as on failure.
    expect(terminate).toHaveBeenCalled();
  });

  it('falls back to the inline worker when Worker is unavailable', async () => {
    // Node has no global Worker, so the default path must not throw.
    expect(typeof Worker).toBe('undefined');
    const onFallback = vi.fn();
    const total = await countPlaylistEntries(file(playlist(40)), { onFallback });
    expect(total).toBe(40);
    expect(onFallback).toHaveBeenCalledWith('unsupported_environment');
  });

  it('falls back when the worker factory throws', async () => {
    const onFallback = vi.fn();
    const factory: WorkerFactory = () => {
      throw new Error('blocked by CSP');
    };
    const total = await countPlaylistEntries(file(playlist(12)), {
      workerFactory: factory,
      onFallback,
    });
    expect(total).toBe(12);
    expect(onFallback).toHaveBeenCalledWith('worker_failed');
  });

  it('falls back when the worker never reports ready', async () => {
    vi.useFakeTimers();
    try {
      const onFallback = vi.fn();
      const neverReady: WorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };

      const result = countPlaylistEntries(file(playlist(5)), {
        workerFactory: () => neverReady,
        onFallback,
      });

      await vi.advanceTimersByTimeAsync(WORKER_READY_TIMEOUT_MS + 10);
      await expect(result).resolves.toBe(5);
      expect(onFallback).toHaveBeenCalledWith('worker_failed');
      expect(neverReady.terminate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces an entry limit error with a user-facing message', async () => {
    const { worker } = wrapInlineWorker();
    await expect(
      countPlaylistEntries(file(playlist(4)), { workerFactory: () => worker, maxEntries: 2 }),
    ).rejects.toMatchObject({ code: 'entry_limit_exceeded' });
  });

  it('surfaces an invalid playlist error', async () => {
    const { worker } = wrapInlineWorker();
    await expect(
      countPlaylistEntries(file('definitely not a playlist'), { workerFactory: () => worker }),
    ).rejects.toBeInstanceOf(M3uImportError);
  });

  it('refuses to construct the real worker outside a browser', () => {
    expect(() => createM3uWorker()).toThrow();
  });
});

describe('streamPlaylistChunks', () => {
  it('uploads one chunk at a time and reports absolute chunk indexes', async () => {
    const { worker } = wrapInlineWorker();
    const uploaded: { index: number; count: number; first: string | undefined }[] = [];

    const total = await streamPlaylistChunks(file(playlist(2_500)), {
      workerFactory: () => worker,
      onChunk: (entries, index) => {
        uploaded.push({ index, count: entries.length, first: entries[0]?.name });
      },
    });

    expect(total).toBe(2_500);
    expect(uploaded.map((chunk) => chunk.count)).toEqual([1_000, 1_000, 500]);
    expect(uploaded.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
    expect(uploaded[1]?.first).toBe('Channel 1000');
  });

  it('waits for the upload promise before requesting the next chunk', async () => {
    const { worker } = wrapInlineWorker();
    const gate: { release: (() => void) | null } = { release: null };
    const uploaded: number[] = [];

    const run = streamPlaylistChunks(file(playlist(2_500)), {
      workerFactory: () => worker,
      onChunk: (_entries, index) => {
        uploaded.push(index);
        if (index === 0) {
          return new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        }
        return undefined;
      },
    });

    // Let the first chunk arrive; the second must not be delivered yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(uploaded).toEqual([0]);

    gate.release?.();
    await run;
    expect(uploaded).toEqual([0, 1, 2]);
  });

  it('resumes from a completed chunk offset', async () => {
    const { worker } = wrapInlineWorker();
    const uploaded: { index: number; first: string | undefined }[] = [];

    const total = await streamPlaylistChunks(file(playlist(2_500)), {
      workerFactory: () => worker,
      skipChunks: 1,
      onChunk: (entries, index) => {
        uploaded.push({ index, first: entries[0]?.name });
      },
    });

    expect(total).toBe(2_500);
    expect(uploaded).toEqual([
      { index: 1, first: 'Channel 1000' },
      { index: 2, first: 'Channel 2000' },
    ]);
  });

  it('reports a failed upload as a chunk error and stops the worker', async () => {
    const { worker, terminate } = wrapInlineWorker();
    const uploaded: number[] = [];

    await expect(
      streamPlaylistChunks(file(playlist(1_200)), {
        workerFactory: () => worker,
        onChunk: (_entries, index) => {
          uploaded.push(index);
          throw new Error('Network down');
        },
      }),
    ).rejects.toMatchObject({ code: 'chunk_failed', message: 'Network down' });

    expect(uploaded).toEqual([0]);
    expect(terminate).toHaveBeenCalled();
  });

  it('cancels through the abort signal', async () => {
    const { worker, terminate } = wrapInlineWorker();
    const controller = new AbortController();

    const run = streamPlaylistChunks(file(playlist(2_500)), {
      workerFactory: () => worker,
      signal: controller.signal,
      onChunk: () => {
        controller.abort();
      },
    });

    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(terminate).toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { worker } = wrapInlineWorker();
    const controller = new AbortController();
    controller.abort();

    await expect(
      streamPlaylistChunks(file(playlist(10)), {
        workerFactory: () => worker,
        signal: controller.signal,
        onChunk: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
