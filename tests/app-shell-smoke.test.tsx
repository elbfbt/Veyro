// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { BrandProvider } from '../src/brand/BrandProvider';
import { AuthProvider } from '../src/state/AuthContext';
import { LibraryProvider } from '../src/state/LibraryContext';
import { PreferencesProvider } from '../src/state/PreferencesContext';
import { ToastProvider } from '../src/state/ToastContext';

const mockFetch = vi.fn(async (url: string | URL) => {
  const path = typeof url === 'string' ? url : url.pathname;
  if (path === '/api/auth/csrf') {
    return new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
});

beforeEach(() => {
  mockFetch.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  cleanup();
});

describe('app shell smoke test', () => {
  it('mounts the shell with the skip link and an anonymous home state', async () => {
    render(
      <BrandProvider>
        <PreferencesProvider>
          <AuthProvider>
            <LibraryProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={['/']}>
                  <App />
                </MemoryRouter>
              </ToastProvider>
            </LibraryProvider>
          </AuthProvider>
        </PreferencesProvider>
      </BrandProvider>,
    );

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeTruthy();
    expect(await screen.findByText('Add your first provider to start watching')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Primary navigation' })).toBeTruthy();
  });
});
