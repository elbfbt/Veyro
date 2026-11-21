# Veyro architecture notes

## Direct playback rule

There is no `/proxy-stream` endpoint and there is no generic fetch of provider media in the Worker. The intended flow is:

```
User's IPTV provider ──(video)──> Browser / phone / TV device
User's provider metadata ──> Veyro Worker + D1 ──> authenticated UI
```

The Worker owns accounts, sessions, provider metadata, EPG metadata, settings, devices and pairing state. Credentials are encrypted at rest with a secret key and are never returned in normal API responses, logged, or placed in URLs.

## Cloudflare Workers Static Assets

The Vite SPA builds to `dist/client`. Wrangler uploads those files as Workers Static Assets. `not_found_handling = "single-page-application"` makes direct navigation to client routes return the SPA shell; `run_worker_first = ["/api/*"]` explicitly sends API traffic to the Worker.

## Browser limitations (honest constraints)

- **CORS**: some providers do not allow cross-origin manifest or segment requests. The web player will report this clearly; a native Android/Android TV adapter can play those streams without browser CORS restrictions.
- **Codecs**: H.264/H.265/AV1 support depends on the device browser and OS. Engine selection will be capability-based, not assumed.
- **DRM**: protected streams need a licensed DRM integration and are not part of the initial client.
- **Autoplay**: browsers may block playback with sound until the user interacts. The player will surface a user gesture prompt instead of silently failing.
- **Self-signed/insecure origins**: mixed content rules block HTTP streams from an HTTPS app. Native clients can relax this later; the web app will explain it.

These are limitations of the environment, not missing data that can be faked.

## Future Android reuse

The following are designed to be platform-neutral and reusable by a future native app:

- API contracts under `/api`
- D1 schema and ownership rules
- Pairing session model (token hash, expiry, single use)
- Provider and device models
- Playback engine selection concept (native, HLS, Shaka, native-mobile adapter)

Core parsing and preference logic stays in plain TypeScript modules without browser-only dependencies where practical.

## Phase 2 authentication implementation

- `worker/services/auth/` isolates the auth business logic behind small interfaces. `D1AuthRepository` and `D1RateLimiter` are the only D1-aware adapters; the service, password hasher and token helpers are plain TypeScript and fully unit tested.
- Passwords use Web Crypto PBKDF2-SHA-256 (100,000 iterations — the Cloudflare Workers/workerd maximum — 16-byte random salt, 256-bit output). Stored format: `pbkdf2-sha256$iterations$salt$hash`; hashes with an unsupported cost are rejected before derivation. Unknown-account logins perform the same work as wrong-password logins.
- Session tokens are 32-byte random values. Only their SHA-256 digests are stored in `sessions.token_hash`. The raw token exists only in an httpOnly, Secure (except local HTTP), SameSite=Lax cookie and is never logged or returned after creation.
- State-changing API requests require both a readable `veyro_csrf` cookie and a matching `X-CSRF-Token` header, plus a same-origin `Origin` header when one is present. Login and registration are protected too.
- Sessions expire after 30 days; `last_seen_at` is refreshed on authenticated reads. Users can list and revoke their own sessions, and all session queries are scoped by `user_id`.
- Failed login/registration attempts are rate limited per client and email in D1 (10 attempts per 15 minutes). No Redis or external auth service.
- Devices are upserted by `(user_id, name)` on login/register so friendly names such as "Living Room TV" are ready for native apps.
- Password reset is an architecture placeholder: the request endpoint always returns the same generic response, creates no token, sends no email, and confirmation returns `501`.

## Security rules for all phases

1. Hash passwords with a mature Workers-compatible primitive; never store plaintext.
2. Store only credential ciphertext; never log credentials.
3. Hash pairing tokens before storage; QR contains only the public connect URL plus the temporary token.
4. Use secure cookies, CSRF protection for authenticated state changes, expiry and rate limits.
5. Scope every D1 query by user ownership; no cross-user reads.
6. Never add a video relay endpoint.
