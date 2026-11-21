import { ContentError } from './service';

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export interface ContentApiService {
  channels(userId: string, params: URLSearchParams): Promise<unknown>;
  movies(userId: string, params: URLSearchParams): Promise<unknown>;
  series(userId: string, params: URLSearchParams): Promise<unknown>;
  categories(userId: string, params: URLSearchParams): Promise<unknown>;
  channel(userId: string, id: string): Promise<unknown>;
  movie(userId: string, id: string): Promise<unknown>;
  channelStream(userId: string, id: string): Promise<unknown>;
  movieStream(userId: string, id: string): Promise<unknown>;
  seriesDetail(userId: string, id: string): Promise<unknown>;
  episodes(userId: string, id: string, params: URLSearchParams): Promise<unknown>;
  episodeStream(userId: string, id: string): Promise<unknown>;
  episode(userId: string, id: string): Promise<unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function page(key: string, result: unknown): Response {
  const value = result as { items: unknown[]; pagination: unknown };
  return json({ [key]: value.items, pagination: value.pagination });
}

/** Returns null for non-content routes so api.ts can continue routing. */
export async function handleContentApi(
  request: Request,
  url: URL,
  userId: string,
  service: ContentApiService,
): Promise<Response | null> {
  if (request.method.toUpperCase() !== 'GET') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api' || segments.length < 2 || segments.length > 4) return null;
  const resource = segments[1];

  try {
    if (segments.length === 2) {
      if (resource === 'channels') return page('channels', await service.channels(userId, url.searchParams));
      if (resource === 'movies') return page('movies', await service.movies(userId, url.searchParams));
      if (resource === 'series') return page('series', await service.series(userId, url.searchParams));
      if (resource === 'categories') return page('categories', await service.categories(userId, url.searchParams));
      return null;
    }

    const id = segments[2];
    if (!id || id.length > 128) throw new ContentError('not_found', 404, 'Content not found.');

    if (segments.length === 3) {
      if (resource === 'channels') return json({ channel: await service.channel(userId, id) });
      if (resource === 'movies') return json({ movie: await service.movie(userId, id) });
      if (resource === 'series') return json({ series: await service.seriesDetail(userId, id) });
      if (resource === 'episodes') return json({ episode: await service.episode(userId, id) });
      return null;
    }

    if (resource === 'series' && segments[3] === 'episodes') {
      return page('episodes', await service.episodes(userId, id, url.searchParams));
    }

    if (segments.length === 4 && segments[3] === 'stream') {
      if (resource === 'channels') return json({ stream: await service.channelStream(userId, id) });
      if (resource === 'movies') return json({ stream: await service.movieStream(userId, id) });
      if (resource === 'episodes') return json({ stream: await service.episodeStream(userId, id) });
      return null;
    }
    return null;
  } catch (error) {
    if (error instanceof ContentError) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: 'internal_error', message: 'The request could not be completed.' }, 500);
  }
}
