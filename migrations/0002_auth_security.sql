-- Phase 2 authentication hardening.
-- Passwords remain PBKDF2 hashes in users.password_hash. Session tokens are
-- never stored: only their SHA-256 digests live in sessions.token_hash.

CREATE TABLE IF NOT EXISTS auth_attempts (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_window ON auth_attempts(window_start);

-- Placeholder for a future email delivery implementation. No reset token is
-- returned to the client while mail delivery is unavailable.
CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expiry ON password_resets(expires_at);
