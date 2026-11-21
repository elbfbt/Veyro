-- Phase 5D: Chunked M3U file import job tracking.
-- Tracks the progress of large playlist imports across multiple chunked requests.
-- Job state persists in D1 so imports can survive page refreshes and be resumed.

CREATE TABLE IF NOT EXISTS import_jobs (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id        TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  filename           TEXT NOT NULL,
  total_entries      INTEGER NOT NULL DEFAULT 0,
  imported_entries   INTEGER NOT NULL DEFAULT 0,
  total_chunks       INTEGER NOT NULL DEFAULT 0,
  completed_chunks   INTEGER NOT NULL DEFAULT 0,
  last_processed_chunk INTEGER NOT NULL DEFAULT -1,
  last_chunk_hash    TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'importing', 'completed', 'failed', 'expired')),
  error              TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON import_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_provider ON import_jobs(provider_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_expires ON import_jobs(expires_at);
