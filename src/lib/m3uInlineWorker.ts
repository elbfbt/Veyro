/**
 * Inline (main-thread) implementation of the M3U worker protocol.
 *
 * Used when `Worker` is unavailable (older browsers, tests, some embedded
 * webviews) or when the module worker fails to load. It exposes the same
 * `WorkerLike` surface as a real worker so the import client has one code path.
 * Parsing is incremental and yields between slices, so the UI stays responsive.
 */

import {
  createImportSession,
  type M3uWorkerRequest,
  type M3uWorkerResponse,
  type WorkerLike,
} from './m3uWorkerProtocol';

export function createInlineM3uWorker(): WorkerLike {
  let terminated = false;

  const deliver = (message: M3uWorkerResponse) => {
    if (terminated) return;
    worker.onmessage?.({ data: message });
  };

  const session = createImportSession({
    post: (message) => {
      queueMicrotask(() => deliver(message));
    },
  });

  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: M3uWorkerRequest) {
      if (terminated) return;
      queueMicrotask(() => {
        if (terminated) return;
        try {
          session.handleMessage(message);
        } catch (error) {
          worker.onerror?.(error);
        }
      });
    },
    terminate() {
      terminated = true;
      session.cancel();
    },
  };

  queueMicrotask(() => deliver({ type: 'ready' }));

  return worker;
}
