/**
 * Module worker entry point for M3U parsing.
 *
 * All parsing logic lives in `m3uWorkerProtocol.ts` (pure, unit-testable); this
 * file only wires it to the worker message port.
 *
 * Instantiated by `createM3uWorker()` in `m3uImportClient.ts`:
 *   new Worker(new URL('./m3uParser.worker.ts', import.meta.url), { type: 'module' })
 */

import { createImportSession, type M3uWorkerRequest, type M3uWorkerResponse } from './m3uWorkerProtocol';

/** Minimal worker global surface; keeps this file free of the WebWorker lib. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<M3uWorkerRequest>) => void) | null;
  postMessage: (message: M3uWorkerResponse) => void;
}

const scope = globalThis as unknown as WorkerScope;

const session = createImportSession({
  post: (message) => scope.postMessage(message),
});

scope.onmessage = (event) => {
  session.handleMessage(event.data);
};

// Announce readiness so the client can detect a worker that never loaded
// (blocked by CSP, unsupported module workers) and fall back instead of hanging.
scope.postMessage({ type: 'ready' });
