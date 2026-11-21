import {
  AuthError,
  type AuthRepository,
  type AuthResult,
  type AuthUser,
  type AuthenticatedContext,
  type Clock,
  type IdGenerator,
  type PasswordHasher,
  type RateLimiter,
} from './types';
import { hashToken, randomToken } from './tokens';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface AuthServiceDependencies {
  repository: AuthRepository;
  hasher: PasswordHasher;
  limiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  sessionTtlSeconds?: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  deviceName?: string;
  platform?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceName?: string;
  platform?: string;
  clientKey?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateEmail(value: string): string {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new AuthError('validation_error', 'Enter a valid email address.');
  }
  return email;
}

function validatePassword(value: string): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    throw new AuthError('validation_error', 'Password must be 10–128 characters.');
  }
  return value;
}

function cleanDisplayName(value: string | undefined, email: string): string {
  const fallback = email.split('@')[0]?.slice(0, 60) || 'Viewer';
  const name = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return name || fallback;
}

function cleanDeviceName(value: string | undefined): string {
  const name = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return name || 'This browser';
}

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * All authentication business logic lives here. Swapping D1 or adding an
 * external identity provider requires a new repository/service adapter, not
 * changes to routes or UI.
 */
export class AuthService {
  private readonly repository: AuthRepository;
  private readonly hasher: PasswordHasher;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly sessionTtlSeconds: number;
  private dummyHash?: Promise<string>;

  constructor(dependencies: AuthServiceDependencies) {
    this.repository = dependencies.repository;
    this.hasher = dependencies.hasher;
    this.limiter = dependencies.limiter;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
    this.sessionTtlSeconds = dependencies.sessionTtlSeconds ?? SESSION_TTL_SECONDS;
  }

  private async verifyAgainstDummy(password: string): Promise<void> {
    // Equalize work for unknown accounts and wrong passwords.
    this.dummyHash ??= this.hasher.hash('veyro-account-enumeration-guard');
    await this.hasher.verify(password, await this.dummyHash);
  }

  private async createSessionWithUser(
    userId: string,
    deviceName: string | undefined,
    platform: string | undefined,
  ): Promise<{ token: string; session: AuthResult['session'] }> {
    const now = this.clock.now();
    const token = randomToken(32);
    const tokenHash = await hashToken(token);
    const session = {
      id: this.ids.newId(),
      userId,
      tokenHash,
      createdAt: now,
      expiresAt: now + this.sessionTtlSeconds,
      lastSeenAt: now,
    };
    await this.repository.createSession(session);
    await this.repository.upsertDevice({
      id: this.ids.newId(),
      userId,
      name: cleanDeviceName(deviceName),
      platform: platform ?? 'web',
      lastSeenAt: now,
    });
    return { token, session };
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = validateEmail(input.email ?? '');
    const password = validatePassword(input.password ?? '');
    const now = this.clock.now();

    if (!(await this.limiter.allow(`register:${email}`, now))) {
      throw new AuthError('rate_limited', 'Too many attempts. Please try again later.');
    }
    if (await this.repository.findUserByEmail(email)) {
      throw new AuthError('email_taken', 'An account with that email already exists.');
    }

    const passwordHash = await this.hasher.hash(password);
    const user = {
      id: this.ids.newId(),
      email,
      passwordHash,
      displayName: cleanDisplayName(input.displayName, email),
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createUser(user);
    const { token, session } = await this.createSessionWithUser(user.id, input.deviceName, input.platform);
    return { user: toPublicUser(user), token, session };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = validateEmail(input.email ?? '');
    const password = validatePassword(input.password ?? '');
    const now = this.clock.now();
    const client = (input.clientKey ?? 'unknown').slice(0, 80);

    if (!(await this.limiter.allow(`login:${client}:${email}`, now))) {
      throw new AuthError('rate_limited', 'Too many attempts. Please try again later.');
    }

    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      await this.verifyAgainstDummy(password);
      throw new AuthError('invalid_credentials', 'Email or password is incorrect.');
    }

    const valid = await this.hasher.verify(password, user.passwordHash);
    if (!valid) throw new AuthError('invalid_credentials', 'Email or password is incorrect.');

    const { token, session } = await this.createSessionWithUser(user.id, input.deviceName, input.platform);
    return { user: toPublicUser(user), token, session };
  }

  async authenticateToken(token: string | null): Promise<AuthenticatedContext | null> {
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    const now = this.clock.now();
    if (!session || session.expiresAt <= now) return null;
    const user = await this.repository.findUserById(session.userId);
    if (!user) return null;
    await this.repository.touchSession(session.id, now);
    return { user: toPublicUser(user), session };
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.repository.deleteSession(userId, sessionId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.repository.deleteSession(userId, sessionId);
  }

  async listSessions(userId: string) {
    return this.repository.listSessions(userId);
  }

  async listDevices(userId: string) {
    return this.repository.listDevices(userId);
  }

  /** No email delivery is configured; this intentionally performs no state change. */
  async requestPasswordReset(_email: string): Promise<void> {
    return Promise.resolve();
  }
}
