-- Veyro initial schema.
-- All timestamps are Unix seconds (UTC). All credential material is stored
-- encrypted by the Worker using a secret key; plaintext credentials never
-- reach D1, logs, URLs or normal API responses.

PRAGMA foreign_keys = ON;

-- Accounts and sessions -----------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT 'Viewer',
  avatar_url      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Devices (web, Android, Android TV, phone, tablet) --------------------------

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('web', 'android', 'android_tv', 'phone', 'tablet')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- User-supplied IPTV sources -------------------------------------------------

CREATE TABLE IF NOT EXISTS providers (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('m3u_url', 'm3u_file', 'xtream')),
  server_url            TEXT,
  -- Encrypted JSON blob. Never returned by ordinary API responses.
  credentials_encrypted BLOB,
  credentials_key_id    TEXT,
  epg_url               TEXT,
  is_default            INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'refreshing', 'error', 'disabled')),
  last_refreshed_at     INTEGER,
  metadata              TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_default
  ON providers(user_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS playlists (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id       TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  source_url        TEXT,
  item_count        INTEGER NOT NULL DEFAULT 0,
  checksum          TEXT,
  status            TEXT NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('pending', 'ready', 'error')),
  last_imported_at  INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_playlists_provider ON playlists(provider_id);

-- Normalized IPTV catalogue --------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id  TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id  TEXT,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'channel' CHECK (type IN ('channel', 'movie', 'series')),
  UNIQUE (provider_id, external_id, type)
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id    TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  external_id    TEXT NOT NULL,
  name           TEXT NOT NULL,
  tvg_id         TEXT,
  tvg_name       TEXT,
  logo_url       TEXT,
  stream_url     TEXT NOT NULL,
  channel_number TEXT,
  country        TEXT,
  language       TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_provider ON channels(provider_id);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id);
CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS movies (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id    TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  poster_url     TEXT,
  backdrop_url   TEXT,
  stream_url     TEXT NOT NULL,
  year           INTEGER,
  genre          TEXT,
  duration_sec   INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_movies_user ON movies(user_id);
CREATE INDEX IF NOT EXISTS idx_movies_provider ON movies(provider_id);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS series (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id    TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  poster_url     TEXT,
  backdrop_url   TEXT,
  year           INTEGER,
  genre          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_series_user ON series(user_id);
CREATE INDEX IF NOT EXISTS idx_series_provider ON series(provider_id);
CREATE INDEX IF NOT EXISTS idx_series_title ON series(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS episodes (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id     TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  series_id       TEXT REFERENCES series(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  stream_url      TEXT NOT NULL,
  season_number   INTEGER,
  episode_number  INTEGER,
  duration_sec    INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_episodes_user ON episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title COLLATE NOCASE);

-- Lightweight EPG concept: current/next/schedule without a heavy backend -----

CREATE TABLE IF NOT EXISTS epg_programs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id  TEXT,
  title        TEXT NOT NULL,
  description  TEXT,
  start_time   INTEGER NOT NULL,
  end_time     INTEGER NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_epg_channel_time ON epg_programs(channel_id, start_time);

-- Personal library -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS favorites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('channel', 'movie', 'series', 'episode')),
  target_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS watch_history (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL CHECK (target_type IN ('channel', 'movie', 'series', 'episode')),
  target_id       TEXT NOT NULL,
  progress_sec    INTEGER NOT NULL DEFAULT 0,
  duration_sec    INTEGER,
  watched_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_history_user ON watch_history(user_id, watched_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('channel', 'movie', 'series', 'episode')),
  target_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, created_at DESC);

-- Preferences ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_settings (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (sidebar_collapsed IN (0, 1)),
  theme             TEXT NOT NULL DEFAULT 'dark',
  density           TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  motion            TEXT NOT NULL DEFAULT 'full' CHECK (motion IN ('full', 'reduced')),
  tv_mode           INTEGER NOT NULL DEFAULT 0 CHECK (tv_mode IN (0, 1)),
  language          TEXT NOT NULL DEFAULT 'en',
  preferred_player  TEXT NOT NULL DEFAULT 'auto',
  fallback_player   TEXT NOT NULL DEFAULT 'auto',
  autoplay          INTEGER NOT NULL DEFAULT 1 CHECK (autoplay IN (0, 1)),
  auto_reconnect    INTEGER NOT NULL DEFAULT 1 CHECK (auto_reconnect IN (0, 1)),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- QR phone-to-TV pairing -----------------------------------------------------
-- Only a hash of the short-lived token is stored. Any temporary configuration
-- uploaded by the phone is encrypted and wiped when the session completes.

CREATE TABLE IF NOT EXISTS pairing_sessions (
  id                 TEXT PRIMARY KEY,
  token_hash         TEXT NOT NULL UNIQUE,
  short_code         TEXT NOT NULL UNIQUE,
  device_id          TEXT REFERENCES devices(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'expired', 'revoked')),
  expires_at         INTEGER NOT NULL,
  temp_payload       BLOB,
  attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at       INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pairing_token ON pairing_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_pairing_expiry ON pairing_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_status ON pairing_sessions(status);
