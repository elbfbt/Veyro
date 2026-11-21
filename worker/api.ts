/**
 * API routing kept free of Cloudflare-specific types so it can be unit tested
 * with standard Request/Response objects.
 */
import { AuthError } from './services/auth/types';
import type { AuthService } from './services/auth/service';
import { SESSION_TTL_SECONDS } from './services/auth/service';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  readCookie,
  shouldUseSecureCookie,
  serializeCookie,
} from './http/cookies';
import { isAllowedOrigin, isCsrfRequestValid, newCsrfToken } from './http/csrf';

export interface ApiDependencies {
  auth: AuthService;
  databaseBound: boolean;
  now: () => number;
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders instanceof Headers) {
    // Preserve multiple Set-Cookie headers instead of combining them.
    const withGetSetCookie = extraHeaders as Headers & { getSetCookie?: () => string[] };
    const setCookies = withGetSetCookie.getSetCookie?.() ?? [];
    for (const cookie of setCookies) headers.append('set-cookie', cookie);
    extraHeaders.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') headers.append(key, value);
    });
  } else if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    const status =
      error.code === 'authentication_required'
        ? 401
        : error.code === 'rate_limited'
          ? 429
          : error.code === 'email_taken'
            ? 409
            : 400;
    return json({ error: error.code, message: error.message }, status);
  }
  // Never echo internal errors, SQL or user input back to the client.
  return json({ error: 'internal_error', message: 'The request could not be completed.' }, 500);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AuthError('validation_error', 'Invalid request body.');
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function platformFromUserAgent(agent: string | null): string {
  if (!agent) return 'web';
  if (/android tv|smart tv|crkey|tizen|webos/i.test(agent)) return 'android_tv';
  if (/android/i.test(agent)) return 'android';
  if (/ipad|tablet/i.test(agent)) return 'tablet';
  if (/iphone|mobile/i.test(agent)) return 'phone';
  return 'web';
}

function clientKey(request: Request): string {
  // Used only as a rate-limit bucket key. Never logged or persisted.
  return request.headers.get('cf-connecting-ip') ?? 'local';
}

function sessionCookie(token: string, url: URL): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    secure: shouldUseSecureCookie(url),
  });
}

function csrfCookie(token: string, url: URL): string {
  return serializeCookie(CSRF_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: false,
    secure: shouldUseSecureCookie(url),
  });
}

function appendCookie(headers: Headers, cookie: string): void {
  headers.append('set-cookie', cookie);
}

function ensureCsrfToken(request: Request, headers: Headers, url: URL): string {
  const existing = readCookie(request, CSRF_COOKIE);
  if (existing && existing.length >= 20) return existing;
  const token = newCsrfToken();
  appendCookie(headers, csrfCookie(token, url));
  return token;
}

export function createApiHandler(dependencies: ApiDependencies) {
  return async function handleApi(request: Request, url: URL): Promise<Response> {
    try {
      const path = url.pathname;
      const method = request.method.toUpperCase();
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

      if (mutating && !isAllowedOrigin(request.headers.get('origin'), url)) {
        return json({ error: 'origin_rejected', message: 'Cross-origin request rejected.' }, 403);
      }
      if (mutating && !isCsrfRequestValid(request)) {
        return json({ error: 'csrf_failed', message: 'CSRF token missing or invalid.' }, 403);
      }

      if (path === '/api/health' && method === 'GET') {
        return json({
          status: 'ok',
          service: 'veyro',
          databaseBinding: dependencies.databaseBound,
        });
      }

      if (path === '/api/auth/csrf' && method === 'GET') {
        const headers = new Headers();
        const csrfToken = ensureCsrfToken(request, headers, url);
        return json({ csrfToken }, 200, headers);
      }

      if (path === '/api/auth/forgot-password' && method === 'POST') {
        // No mail provider is configured. Always return the same generic reply
        // and do not create or expose a reset token.
        return json(
          {
            accepted: true,
            message: 'If an account exists, a reset link will be sent once email delivery is configured.',
          },
          202,
        );
      }

      if (path === '/api/auth/password-reset/confirm' && method === 'POST') {
        return json(
          { error: 'not_implemented', message: 'Password reset confirmation requires email delivery.' },
          501,
        );
      }

      if (path === '/api/auth/register' && method === 'POST') {
        const body = await readJson(request);
        const result = await dependencies.auth.register({
          email: stringValue(body.email),
          password: stringValue(body.password),
          displayName: stringValue(body.displayName),
          deviceName: stringValue(body.deviceName),
          platform: platformFromUserAgent(request.headers.get('user-agent')),
        });
        const headers = new Headers();
        appendCookie(headers, sessionCookie(result.token, url));
        const csrfToken = newCsrfToken();
        appendCookie(headers, csrfCookie(csrfToken, url));
        return json(
          { user: result.user, csrfToken, expiresAt: result.session.expiresAt },
          201,
          headers,
        );
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readJson(request);
        const result = await dependencies.auth.login({
          email: stringValue(body.email),
          password: stringValue(body.password),
          deviceName: stringValue(body.deviceName),
          platform: platformFromUserAgent(request.headers.get('user-agent')),
          clientKey: clientKey(request),
        });
        const headers = new Headers();
        appendCookie(headers, sessionCookie(result.token, url));
        const csrfToken = newCsrfToken();
        appendCookie(headers, csrfCookie(csrfToken, url));
        return json(
          { user: result.user, csrfToken, expiresAt: result.session.expiresAt },
          200,
          headers,
        );
      }

      // Unknown, not-yet-implemented APIs return 501 without demanding a
      // session; known protected routes below do require authentication.
      if (!path.startsWith('/api/auth/')) {
        return json(
          {
            error: 'not_implemented',
            message: 'This API endpoint is planned for a later implementation phase.',
          },
          501,
        );
      }

      // Everything below requires a valid session.
      const context = await dependencies.auth.authenticateToken(readCookie(request, SESSION_COOKIE));
      if (!context) throw new AuthError('authentication_required', 'Sign in to continue.');

      if (path === '/api/auth/me' && method === 'GET') {
        const headers = new Headers();
        const csrfToken = ensureCsrfToken(request, headers, url);
        return json(
          {
            user: context.user,
            csrfToken,
            sessionId: context.session.id,
            expiresAt: context.session.expiresAt,
          },
          200,
          headers,
        );
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        await dependencies.auth.logout(context.user.id, context.session.id);
        const headers = new Headers();
        appendCookie(headers, serializeCookie(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true, secure: shouldUseSecureCookie(url) }));
        appendCookie(headers, serializeCookie(CSRF_COOKIE, '', { maxAge: 0, httpOnly: false, secure: shouldUseSecureCookie(url) }));
        return json({ ok: true }, 200, headers);
      }

      if (path === '/api/auth/sessions' && method === 'GET') {
        const sessions = await dependencies.auth.listSessions(context.user.id);
        return json({
          sessions: sessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt,
            current: session.id === context.session.id,
          })),
        });
      }

      if (path.startsWith('/api/auth/sessions/') && method === 'DELETE') {
        const sessionId = path.slice('/api/auth/sessions/'.length);
        if (!sessionId || sessionId.length > 128) {
          throw new AuthError('validation_error', 'Invalid session identifier.');
        }
        const removed = await dependencies.auth.revokeSession(context.user.id, sessionId);
        return json({ ok: removed }, removed ? 200 : 404);
      }

      if (path === '/api/auth/devices' && method === 'GET') {
        const devices = await dependencies.auth.listDevices(context.user.id);
        return json({ devices });
      }

      if (path.startsWith('/api/auth/')) {
        return json({ error: 'not_found', message: 'Unknown authentication endpoint.' }, 404);
      }

      // Implemented in phases 3–7. A truthful 501 is preferable to placeholder
      // data that looks like a working API.
      return json(
        {
          error: 'not_implemented',
          message: 'This API endpoint is planned for a later implementation phase.',
        },
        501,
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}
