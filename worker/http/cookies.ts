export const SESSION_COOKIE = 'veyro_session';
export const CSRF_COOKIE = 'veyro_csrf';

export interface CookieOptions {
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Lax' | 'Strict';
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
    options.httpOnly ? 'HttpOnly' : '',
    options.secure ? 'Secure' : '',
  ].filter(Boolean);
  return attributes.join('; ');
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) cookies[name] = value;
  }
  return cookies;
}

export function readCookie(request: Request, name: string): string | null {
  return parseCookies(request.headers.get('cookie'))[name] ?? null;
}

/** HTTP on localhost is a trustworthy context; production is always HTTPS. */
export function shouldUseSecureCookie(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
