# Implementation plan

## Pre-code assessment

The repository was inspected first: only a two-line `README.md` existed, so no work was overwritten. The referenced Figma community design was inspected and used only as a visual reference. The attached preview image was also reviewed.

## Phase 1 (this implementation)

1. Scaffold Vite + React + TypeScript, ESLint, Vitest and strict TypeScript configs.
2. Add a single Cloudflare Worker with Workers Static Assets, `/api/health`, D1 binding and SPA routing.
3. Add the initial D1 migration with ownership-scoped tables and indexes.
4. Centralize brand identity and apply a premium dark streaming design system.
5. Build the responsive shell: collapsible sidebar, mobile drawer/bottom nav, TV mode and D-pad focus.
6. Build all required routes, with honest placeholders for later-phase features.
7. Build the cinematic home page with hero carousel and seven horizontal demo rows.
8. Add original local artwork, tests and documentation; verify typecheck, lint, tests and builds.

## Phase 2 (this implementation)

1. Added migration `0002_auth_security.sql` with rate-limit and password-reset placeholder tables.
2. Added a replaceable `AuthService` with Web Crypto PBKDF2 hashing, opaque random session tokens and D1 adapters.
3. Added secure cookie handling, CSRF double-submit validation and same-origin checks in the Worker API.
4. Added registration, login, logout, `/me`, session listing/revocation, devices and generic password-reset request endpoints.
5. Replaced the Phase 1 login/register/profile placeholders with real accessible screens.
6. Added unit/integration tests for hashing, tokens, service rules, authorization, CSRF and user isolation; verified the full D1 flow through Wrangler.

## Deferred by design

Providers/parser (3), catalogue depth (4), playback engines/reliability (5), pairing (6), EPG/history/sync (7), TV optimization (8), hardening (9). See `README.md` for the full phase table.

## Dependencies chosen

No Redis, search SaaS, image CDN, paid auth, VPS or video proxy. Only Vite/React tooling, Lucide icons, Cloudflare Wrangler/worker types and test/lint tooling. All are open source and compatible with a $0/month Cloudflare starting point.

## What cannot work in a browser

CORS-restricted manifests, unsupported codecs, DRM and autoplay policies. See `docs/ARCHITECTURE.md`. Native Android/Android TV playback is the intended long-term answer and is not built now.
