/** Replaceable authentication contracts. No D1 or browser types live here. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserRecord extends AuthUser {
  passwordHash: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  /** Internal only: SHA-256 digest of the session token. Never sent to clients. */
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  name: string;
  platform: string;
  lastSeenAt: number;
  createdAt: number;
}

export interface NewUserInput {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: number;
}

export interface NewSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface NewDeviceInput {
  id: string;
  userId: string;
  name: string;
  platform: string;
  lastSeenAt: number;
}

export interface AuthRepository {
  createUser(input: NewUserInput): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createSession(input: NewSessionInput): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: number): Promise<void>;
  /** Deletes only when the session belongs to the given user. */
  deleteSession(userId: string, sessionId: string): Promise<boolean>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  upsertDevice(input: NewDeviceInput): Promise<void>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
}

export interface RateLimiter {
  /** Returns false when the key has exceeded its allowance for the window. */
  allow(key: string, now: number): Promise<boolean>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  newId(): string;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export interface AuthResult {
  user: AuthUser;
  /** Plain session token. Returned to the client exactly once, then set as a cookie. */
  token: string;
  session: SessionRecord;
}

export interface AuthenticatedContext {
  user: AuthUser;
  session: SessionRecord;
}

export type AuthErrorCode =
  | 'validation_error'
  | 'email_taken'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'authentication_required';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
