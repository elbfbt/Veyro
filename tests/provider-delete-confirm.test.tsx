// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProvidersSection } from '../src/features/settings/ProvidersSection';
import type { Provider } from '../src/types/providers';

const provider: Provider = {
  id: 'provider-1',
  name: 'Home list',
  type: 'm3u_url',
  enabled: true,
  isDefault: true,
  status: 'active',
  serverUrl: null,
  playlistUrl: 'http://example.test/list.m3u',
  lastRefreshAt: null,
  lastImport: null,
  lastError: null,
  xtreamUsername: null,
  importing: false,
  createdAt: 0,
  updatedAt: 0,
};

const calls: string[] = [];
const mockFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const path = typeof url === 'string' ? url : url.pathname;
  calls.push(`${init?.method ?? 'GET'} ${path}`);
  if (path === '/api/auth/csrf') {
    return new Response(JSON.stringify({ csrfToken: 'csrf' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (path === '/api/providers' && (init?.method ?? 'GET') === 'GET') {
    return new Response(JSON.stringify({ providers: [provider] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (path === '/api/providers/provider-1' && init?.method === 'DELETE') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
});

beforeEach(() => {
  document.cookie = 'veyro_csrf=csrf';
  calls.length = 0;
  mockFetch.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  cleanup();
});

describe('provider deletion', () => {
  it('asks for confirmation before calling DELETE', async () => {
    render(<ProvidersSection />);
    await screen.findByText('Home list');

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));

    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    expect(screen.getByText(/Delete .*Home list.* imported catalogue\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Yes, delete/i }));
    await waitFor(() =>
      expect(calls, JSON.stringify(calls)).toContain('DELETE /api/providers/provider-1'),
    );
  });

  it('cancels without deleting', async () => {
    render(<ProvidersSection />);
    await screen.findByText('Home list');

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });
});
