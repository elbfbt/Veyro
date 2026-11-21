export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionView {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export interface DeviceView {
  id: string;
  userId: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
  expiresAt: number;
}

export interface MeResponse {
  user: AuthUser;
  csrfToken: string;
  sessionId: string;
  expiresAt: number;
}

export interface RegisterFields {
  email: string;
  password: string;
  displayName?: string;
  deviceName?: string;
}

export interface LoginFields {
  email: string;
  password: string;
  deviceName?: string;
}
