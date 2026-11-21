import type { RateLimiter } from './types';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

interface AttemptRow {
  window_start: number;
  attempt_count: number;
}

/** Minimal D1-only limiter; no Redis or paid service required. */
export class D1RateLimiter implements RateLimiter {
  constructor(private readonly db: D1Database) {}

  async allow(key: string, now: number): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT window_start, attempt_count FROM auth_attempts WHERE key = ?')
      .bind(key)
      .first<AttemptRow>();

    if (!row || now - row.window_start >= WINDOW_SECONDS) {
      await this.db
        .prepare(
          `INSERT INTO auth_attempts (key, window_start, attempt_count, updated_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start,
             attempt_count = 1, updated_at = excluded.updated_at`,
        )
        .bind(key, now, now)
        .run();
      return true;
    }

    if (row.attempt_count >= MAX_ATTEMPTS) return false;

    await this.db
      .prepare('UPDATE auth_attempts SET attempt_count = attempt_count + 1, updated_at = ? WHERE key = ?')
      .bind(now, key)
      .run();
    return true;
  }
}
