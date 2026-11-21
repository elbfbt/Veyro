# Veyro

**Veyro is an IPTV client, not an IPTV provider.** Users bring their own M3U playlist or provider credentials. Veyro stores configuration and metadata, but **never relays continuous IPTV video traffic** — streams play directly from the user's provider to their device.

Phase 2 adds real accounts and sessions on top of the Phase 1 foundation: React/Vite SPA, a single Cloudflare Worker with D1 binding, a premium dark streaming UI, responsive shell and clearly marked demo content.

## Stack

- TypeScript, React 18, Vite 6
- Cloudflare Workers + Workers Static Assets + D1, deployed with Wrangler
- Lucide icons, CSS custom properties and cascade layers
- Vitest, TypeScript and ESLint for verification

## Project layout

```
src/
  app/            Routing/navigation definitions
  brand/          Centralized name, colors, logo, metadata
  components/     Layout, UI and media presentation components
  data/           Clearly fictional demo catalogue
  features/       Route-level screens grouped by domain
  hooks/          D-pad navigation hook
  lib/            Pure helpers (spatial navigation, API client)
  state/          Auth, preferences and library contexts
  styles/         Tokens, base, layout, components, pages, auth
  types/          Shared domain types
worker/
  http/           Cookie and CSRF helpers
  services/auth/  Replaceable auth service, D1 adapters, Web Crypto hashing
  api.ts          Route table and request validation
  index.ts        Worker entry point
migrations/       D1 SQL migrations
tests/            Unit tests
public/media/     Locally generated, non-copyrighted placeholder artwork
```

## Quick start

```bash
npm install
npm run dev          # SPA on http://localhost:5173
npm run dev:worker   # optional: API on http://localhost:8787, proxied from Vite
# or: npm run dev:all
```

Authentication requires the Worker. Run `npm run dev:all` (or start both dev commands) so Vite proxies `/api` to Wrangler. Apply the migrations locally once with `npx wrangler d1 migrations apply veyro-db --local`. Unimplemented API routes still return a truthful `501`.

### Verify the build

```bash
npm run verify       # typecheck + lint + tests + SPA build + Worker dry-run build
```

Individual commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run build:worker`.

## Cloudflare configuration

`wrangler.toml` defines:

- `main = "worker/index.ts"` — one Worker for API and asset fallback
- `[assets]` with `directory = "./dist/client"`, `binding = "ASSETS"`, `not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*"]` so direct SPA navigation returns `index.html` while API routes reach the Worker
- `[[d1_databases]]` binding `DB`, database name `veyro-db`, ID `4042ec2d-4af1-4b3d-ab68-673347f3bac1`, migrations in `./migrations`

No credentials are stored in the repository. Copy `.env.example` to `.env` locally if desired, then set real runtime secrets with:

```bash
# Reserved for future signing; Phase 2 sessions use hashed opaque tokens.
wrangler secret put VEYRO_SESSION_SECRET
# Will encrypt provider credentials in Phase 3.
wrangler secret put VEYRO_PROVIDER_SECRET
```

Deploy:

```bash
npm run build
npx wrangler d1 migrations apply veyro-db --remote
npm run deploy
```

## Routes

`/`, `/live`, `/movies`, `/series`, `/search`, `/library`, `/favorites`, `/history`, `/watchlist`, `/settings`, `/profile`, `/player/:id`, `/connect`, `/tv/pair`, `/login`, `/register`.

Login, registration and profile are now real screens. Other later-phase routes show honest "planned" screens rather than fake forms or simulated playback.

## Authentication API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Issues the double-submit CSRF cookie |
| POST | `/api/auth/register` | Creates account, session and default device |
| POST | `/api/auth/login` | Verifies password and creates a session |
| GET | `/api/auth/me` | Returns the current user and session metadata |
| POST | `/api/auth/logout` | Deletes the current session and clears cookies |
| GET | `/api/auth/sessions` | Lists sessions owned by the current user |
| DELETE | `/api/auth/sessions/:id` | Revokes a session owned by the current user |
| GET | `/api/auth/devices` | Lists friendly device names for the current user |
| POST | `/api/auth/forgot-password` | Generic response; email delivery is not configured |
| POST | `/api/auth/password-reset/confirm` | Truthful `501` until email delivery exists |

`GET /api/health` remains available for liveness checks. No stream proxy endpoint exists.

## Phase 1 + 2 feature notes

- **Sidebar**: expandable/collapsible, persisted, tooltip labels when collapsed, keyboard shortcut `Ctrl + \`, mobile drawer + bottom navigation.
- **TV mode**: larger controls and D-pad spatial focus movement; enable under Settings → Interface. Focus is always visible and never hover-only.
- **Search**: local demo search with `/` shortcut.
- **Favorites/watchlist**: local device persistence; account sync is planned with provider data in Phase 7.
- **Authentication**: PBKDF2-SHA-256 password hashes, opaque 30-day session tokens stored only as SHA-256 digests, httpOnly/Secure/SameSite cookies, CSRF double-submit protection, origin checks and D1 rate limiting.
- **Accessible auth UI**: labelled inputs, visible errors, `aria-live` status, no password values in URLs or logs.
- **Demo data**: fictional titles and locally generated artwork. No real streams, credentials or third-party media URLs are bundled.

## Deliberately out of scope (planned phases)

| Phase | Work |
| --- | --- |
| 3 | Provider model, M3U parser, playlist import |
| 4 | Full Live/Movies/Series catalogue views |
| 5 | PlaybackManager, engine selection, fallback, reconnect, 24/7 reliability |
| 6 | QR phone-to-TV pairing with single-use tokens |
| 7 | EPG, history sync, favorites sync, devices |
| 8 | Advanced TV/remote optimization and performance |
| 9 | Production hardening, security review, deployment |

Browser limitations are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): CORS, codec support, DRM and autoplay restrictions cannot be solved honestly in the web client. A future native Android/Android TV adapter will reuse the same API contracts, data models and PlaybackManager concept.

## Design reference

The visual language is inspired by the [3 Free Video Streaming App UI](https://www.figma.com/community/file/1393876552245481056/3-free-video-streaming-app-ui) by slothUI (CC BY 4.0). Veyro uses its own branding, layout, copy and original generated artwork; no reference branding, characters or copyrighted titles are used.

## License

Add the project license before public release. Placeholder artwork in `public/media` is generated for this project.
