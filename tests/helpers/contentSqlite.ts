import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

export type BindValue = string | number | null | Uint8Array;

export interface SqliteStatement {
  all(...params: BindValue[]): unknown[];
  get(...params: BindValue[]): unknown;
  run(...params: BindValue[]): { changes: number | bigint };
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

class SQLiteStatement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: BindValue[] = [],
  ) {}

  bind(...params: BindValue[]) {
    return new SQLiteStatement(this.db, this.sql, params);
  }

  all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

/**
 * Reproduces the production D1 shape that existed before Phase 4. Content is
 * owned through playlist_id -> playlists.provider_id -> providers.user_id and
 * has none of the richer columns added by the repository migrations.
 */
export function makeLegacyContentDatabase(userIds: string[]) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      server_url TEXT,
      username_encrypted TEXT,
      password_encrypted TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      is_default INTEGER
    );
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT,
      source_url TEXT,
      imported_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      playlist_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      sort_order INTEGER
    );
    CREATE TABLE movies (
      id TEXT PRIMARY KEY,
      playlist_id TEXT,
      category_id TEXT,
      name TEXT NOT NULL,
      stream_url TEXT,
      logo_url TEXT,
      year INTEGER,
      duration INTEGER,
      description TEXT
    );
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      playlist_id TEXT,
      category_id TEXT,
      name TEXT NOT NULL,
      stream_url TEXT,
      logo_url TEXT,
      tvg_id TEXT,
      tvg_name TEXT,
      is_live INTEGER
    );
    CREATE TABLE series (
      id TEXT PRIMARY KEY,
      playlist_id TEXT,
      category_id TEXT,
      name TEXT NOT NULL,
      logo_url TEXT,
      year INTEGER,
      description TEXT
    );
    CREATE TABLE episodes (
      id TEXT PRIMARY KEY,
      series_id TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      name TEXT NOT NULL,
      stream_url TEXT,
      duration INTEGER,
      description TEXT
    );
  `);
  userIds.forEach((id, index) => {
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
      id,
      `legacy-${index}@example.com`,
      'hash',
    );
  });
  return db;
}

export function makeContentDatabase(userIds: string[]) {
  const db = new DatabaseSync(':memory:');
  const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  userIds.forEach((id, index) => {
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
      id,
      `content-${index}@example.com`,
      'hash',
    );
  });
  return db;
}

export function contentDatabaseAdapter(db: SqliteDatabase) {
  return {
    prepare(sql: string) {
      return new SQLiteStatement(db, sql);
    },
  };
}
