import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import type {
  AuthResponse,
  DeviceView,
  LoginFields,
  MeResponse,
  RegisterFields,
  SessionView,
  AuthUser,
} from '../types/auth';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  sessionId: string | null;
  csrfToken: string | null;
  bootError: string | null;
  register: (fields: RegisterFields) => Promise<void>;
  login: (fields: LoginFields) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  listSessions: () => Promise<SessionView[]>;
  revokeSession: (id: string) => Promise<void>;
  listDevices: () => Promise<DeviceView[]>;
  requestPasswordReset: (email: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const me = await apiRequest<MeResponse>('/auth/me');
    setUser(me.user);
    setSessionId(me.sessionId);
    setCsrfToken(me.csrfToken);
    setStatus('authenticated');
    setBootError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const csrf = await apiRequest<{ csrfToken: string }>('/auth/csrf');
        if (cancelled) return;
        setCsrfToken(csrf.csrfToken);
        try {
          await refresh();
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 401) {
            setStatus('anonymous');
          } else {
            setStatus('anonymous');
            setBootError(error instanceof Error ? error.message : 'Could not load your session.');
          }
        }
      } catch (error) {
        if (cancelled) return;
        setStatus('anonymous');
        setBootError(error instanceof Error ? error.message : 'Could not contact the API.');
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const register = useCallback(
    async (fields: RegisterFields) => {
      const result = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(fields),
      });
      setCsrfToken(result.csrfToken);
      setUser(result.user);
      setStatus('authenticated');
      await refresh();
    },
    [refresh],
  );

  const login = useCallback(
    async (fields: LoginFields) => {
      const result = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(fields),
      });
      setCsrfToken(result.csrfToken);
      setUser(result.user);
      setStatus('authenticated');
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    const csrf = await apiRequest<{ csrfToken: string }>('/auth/csrf');
    setCsrfToken(csrf.csrfToken);
    setUser(null);
    setSessionId(null);
    setStatus('anonymous');
  }, []);

  const listSessions = useCallback(async () => {
    const result = await apiRequest<{ sessions: SessionView[] }>('/auth/sessions');
    return result.sessions;
  }, []);

  const revokeSession = useCallback(async (id: string) => {
    await apiRequest<{ ok: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (id === sessionId) {
      setUser(null);
      setSessionId(null);
      setStatus('anonymous');
    }
  }, [sessionId]);

  const listDevices = useCallback(async () => {
    const result = await apiRequest<{ devices: DeviceView[] }>('/auth/devices');
    return result.devices;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const result = await apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return result.message;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      sessionId,
      csrfToken,
      bootError,
      register,
      login,
      logout,
      refresh,
      listSessions,
      revokeSession,
      listDevices,
      requestPasswordReset,
    }),
    [status, user, sessionId, csrfToken, bootError, register, login, logout, refresh, listSessions, revokeSession, listDevices, requestPasswordReset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
