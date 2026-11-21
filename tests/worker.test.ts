import { describe, expect, it } from 'vitest';
import { handleApi } from '../worker/api';

describe('worker API phase 1', () => {
  it('exposes a minimal health endpoint', async () => {
    const response = await handleApi(
      new Request('https://veyro.example/api/health'),
      new URL('https://veyro.example/api/health'),
      { DB: {} },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'veyro' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('truthfully reports future endpoints as unimplemented', async () => {
    const response = await handleApi(
      new Request('https://veyro.example/api/channels', { method: 'POST' }),
      new URL('https://veyro.example/api/channels'),
      { DB: {} },
    );
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'not_implemented' });
  });

  it('never exposes a stream proxy endpoint', async () => {
    const response = await handleApi(
      new Request('https://veyro.example/api/proxy-stream'),
      new URL('https://veyro.example/api/proxy-stream'),
      { DB: {} },
    );
    expect(response.status).toBe(501);
  });
});
