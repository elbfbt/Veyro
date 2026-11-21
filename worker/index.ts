/**
 * Veyro's single Cloudflare Worker.
 *
 * Responsibilities: static asset fallback, account/session operations (Phase 2),
 * provider metadata, EPG metadata, pairing and device state.
 *
 * This Worker intentionally contains NO video streaming endpoint. Continuous
 * IPTV traffic always flows directly from the user's provider to their device.
 */
import { createApiHandler } from './api';
import { D1AuthRepository } from './services/auth/d1Repository';
import { D1RateLimiter } from './services/auth/d1RateLimiter';
import { WebCryptoPasswordHasher } from './services/auth/password';
import { AuthService } from './services/auth/service';
import { randomToken } from './services/auth/tokens';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const auth = new AuthService({
        repository: new D1AuthRepository(env.DB),
        hasher: new WebCryptoPasswordHasher(),
        limiter: new D1RateLimiter(env.DB),
        clock: { now: () => Math.floor(Date.now() / 1000) },
        ids: { newId: () => randomToken(18) },
      });
      const handleApi = createApiHandler({
        auth,
        databaseBound: Boolean(env.DB),
        now: () => Math.floor(Date.now() / 1000),
      });
      return handleApi(request, url);
    }

    // Static assets are normally served before the Worker runs; this fallback
    // keeps the SPA working in local `wrangler dev` and direct Worker calls.
    return env.ASSETS.fetch(request);
  },
};
