/**
 * Veyro's single Cloudflare Worker.
 *
 * Responsibilities (now and later): static asset fallback, account/session
 * operations, provider metadata, EPG metadata, pairing and device state.
 *
 * This Worker intentionally contains NO video streaming endpoint. Continuous
 * IPTV traffic always flows directly from the user's provider to their device.
 */
import { handleApi } from './api';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, url, env);
    }

    // Static assets are normally served before the Worker runs; this fallback
    // keeps the SPA working in local `wrangler dev` and direct Worker calls.
    return env.ASSETS.fetch(request);
  },
};
