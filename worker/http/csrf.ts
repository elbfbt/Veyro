import { constantTimeEqual, randomToken } from '../services/auth/tokens';
import { CSRF_COOKIE, readCookie } from './cookies';

export function newCsrfToken(): string {
  return randomToken(24);
}

/** Double-submit cookie pattern: readable cookie must match the custom header. */
export function isCsrfRequestValid(request: Request): boolean {
  const cookieToken = readCookie(request, CSRF_COOKIE);
  const headerToken = request.headers.get('x-csrf-token');
  if (!cookieToken || !headerToken) return false;
  return constantTimeEqual(cookieToken, headerToken);
}

export function isAllowedOrigin(origin: string | null, url: URL): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.origin === url.origin) return true;
    const localhostHosts = ['localhost', '127.0.0.1', '[::1]'];
    return (
      localhostHosts.includes(parsed.hostname) &&
      localhostHosts.includes(url.hostname) &&
      parsed.protocol === url.protocol
    );
  } catch {
    return false;
  }
}
