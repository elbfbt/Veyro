import type {
  AuthRepository,
  DeviceRecord,
  NewDeviceInput,
  NewSessionInput,
  NewUserInput,
  SessionRecord,
  UserRecord,
} from './types';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  created_at: number;
  last_seen_at: number;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** D1-backed adapter. Every query is scoped to an authenticated user where applicable. */
export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  async createUser(input: NewUserInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.email, input.passwordHash, input.displayName, input.createdAt, input.createdAt)
      .run();
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .bind(email)
      .first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async createSession(input: NewSessionInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.userId, input.tokenHash, input.expiresAt, input.createdAt, input.createdAt)
      .run();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .first<SessionRow>();
    return row ? mapSession(row) : null;
  }

  async touchSession(id: string, lastSeenAt: number): Promise<void> {
    await this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(lastSeenAt, id).run();
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, userId)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const result = await this.db
      .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
      .bind(userId)
      .all<SessionRow>();
    return (result.results ?? []).map(mapSession);
  }

  async upsertDevice(input: NewDeviceInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO devices (id, user_id, name, platform, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET last_seen_at = excluded.last_seen_at, platform = excluded.platform`,
      )
      .bind(input.id, input.userId, input.name, input.platform, input.lastSeenAt, input.lastSeenAt)
      .run();
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const result = await this.db
      .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC')
      .bind(userId)
      .all<DeviceRow>();
    return (result.results ?? []).map(mapDevice);
  }
}
