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
