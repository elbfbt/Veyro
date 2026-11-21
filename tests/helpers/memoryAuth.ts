import type {
  AuthRepository,
  DeviceRecord,
  NewDeviceInput,
  NewSessionInput,
  NewUserInput,
  RateLimiter,
  SessionRecord,
  UserRecord,
} from '../../worker/services/auth/types';

export class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly devices = new Map<string, DeviceRecord>();

  async createUser(input: NewUserInput): Promise<void> {
    this.users.set(input.id, {
      ...input,
      updatedAt: input.createdAt,
    });
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    return [...this.users.values()].find((user) => user.email.toLowerCase() === normalized) ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createSession(input: NewSessionInput): Promise<void> {
    this.sessions.set(input.id, { ...input, lastSeenAt: input.createdAt });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async touchSession(id: string, lastSeenAt: number): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.lastSeenAt = lastSeenAt;
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return false;
    return this.sessions.delete(sessionId);
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  async upsertDevice(input: NewDeviceInput): Promise<void> {
    const existing = [...this.devices.values()].find(
      (device) => device.userId === input.userId && device.name === input.name,
    );
    if (existing) {
      existing.lastSeenAt = input.lastSeenAt;
      existing.platform = input.platform;
      return;
    }
    this.devices.set(input.id, { ...input, createdAt: input.lastSeenAt });
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }
}

export class MemoryRateLimiter implements RateLimiter {
  readonly attempts = new Map<string, { windowStart: number; count: number }>();

  async allow(key: string, now: number): Promise<boolean> {
    const current = this.attempts.get(key);
    if (!current || now - current.windowStart >= 900) {
      this.attempts.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (current.count >= 10) return false;
    current.count += 1;
    return true;
  }
}

/** Deterministic non-plaintext hasher for service tests; real PBKDF2 has its own test. */
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `test-hash:${(hash >>> 0).toString(16)}`;
}

export class TestPasswordHasher {
  async hash(password: string): Promise<string> {
    return fingerprint(password);
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    return encoded === fingerprint(password);
  }
}
