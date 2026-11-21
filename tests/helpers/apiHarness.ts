import type { AuthService } from '../../worker/services/auth/service';
import type { ProviderApiService } from '../../worker/services/iptv/providerApi';
import type { ContentApiService } from '../../worker/services/content/api';
import { createApiHandler } from '../../worker/api';

type SetCookieHeaders = Headers & { getSetCookie?: () => string[] };

export function createHarness(
  auth: AuthService,
  origin = 'https://veyro.test',
  providers?: ProviderApiService,
  content?: ContentApiService,
) {
  const jar = new Map<string, string>();
  const handleApi = createApiHandler({ auth, databaseBound: true, now: () => 1_700_000_000, providers, content });

  const updateJar = (response: Response) => {
    const headers = response.headers as SetCookieHeaders;
    const values = headers.getSetCookie
      ? headers.getSetCookie()
      : [headers.get('set-cookie') ?? ''].filter(Boolean);
    for (const value of values) {
      const pair = value.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      if (/max-age=0/i.test(value) || !cookieValue) jar.delete(name);
      else jar.set(name, cookieValue);
    }
  };

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    options: { csrf?: boolean; cookie?: boolean; session?: boolean; rawBody?: BodyInit } = {},
  ) => {
    const headers = new Headers();
    const useCookie = options.cookie ?? true;
    const useSession = options.session ?? true;
    if (useCookie && jar.size > 0) {
      const cookies = [...jar]
        .filter(([name]) => useSession || name !== 'veyro_session')
        .map(([name, value]) => `${name}=${value}`);
      if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
    }
    if (method !== 'GET' && (options.csrf ?? true) && jar.has('veyro_csrf')) {
      headers.set('x-csrf-token', jar.get('veyro_csrf') ?? '');
    }
    const url = `${origin}${path}`;
    const response = await handleApi(
      new Request(url, {
        method,
        headers,
        body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      }),
      new URL(url),
    );
    updateJar(response);
    return response;
  };

  return { call, jar, handleApi };
}
