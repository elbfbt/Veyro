// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProvidersSection } from '../src/features/settings/ProvidersSection';

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  cleanup();
});

function mockProvidersList() {
  mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const path = typeof url === 'string' ? url : url.pathname;
    if (path === '/api/providers' && init?.method === 'GET') {
      return new Response(JSON.stringify({ providers: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/api/auth/csrf') {
      return new Response(JSON.stringify({ csrfToken: 'test-csrf-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
}

describe('ProvidersSection — chunked import blank page bug', () => {
  it('does not crash when clicking "Import M3U file (chunked)" with no file selected', () => {
    mockProvidersList();

    // Rendering and clicking must not throw — previously this crashed because
    // importState.file was null during the 'selecting' phase while the UI
    // accessed importState.file!.size.
    expect(() => {
      render(<ProvidersSection />);
    }).not.toThrow();

    const button = screen.getByRole('button', { name: /Import M3U file \(chunked\)/ });
    fireEvent.click(button);

    // The selecting-phase UI should appear without crashing
    expect(screen.getByText(/Import M3U Playlist/)).toBeDefined();
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });

  it('displays filename and size after selecting a file', () => {
    mockProvidersList();

    render(<ProvidersSection />);

    // Click the chunked import button
    const button = screen.getByRole('button', { name: /Import M3U file \(chunked\)/ });
    fireEvent.click(button);

    // Simulate file selection via the hidden file input (display: none)
    const container = document.querySelector('#providers')!;
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      ['#EXTM3U\n#EXTINF:-1,Test\nhttps://example.com/stream.m3u8\n'],
      'test.m3u8',
      { type: 'application/vnd.apple.mpegurl' },
    );
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    // The filename and size should be displayed
    expect(screen.getByText(/Selected:/)).toBeDefined();
    expect(screen.getByText(/test\.m3u8/)).toBeDefined();
    expect(document.body.textContent).toContain('KB');
  });
});
