/**
 * API routing kept free of Cloudflare-specific types so it can be unit tested
 * with the standard Request/Response interfaces.
 */
export interface ApiEnv {
  DB?: unknown;
}

const JSON_HEADERS: HeadersInit = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleApi(request: Request, url: URL, env: ApiEnv): Promise<Response> {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    // Liveness only. Never echo secrets, credentials or provider URLs.
    return json({
      status: 'ok',
      service: 'veyro',
      databaseBinding: Boolean(env.DB),
    });
  }

  // Implemented in phases 2–7. A truthful 501 is preferable to placeholder
  // data that looks like a working API.
  return json(
    {
      error: 'not_implemented',
      message: 'This API endpoint is planned for a later implementation phase.',
    },
    501,
  );
}
