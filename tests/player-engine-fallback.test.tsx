// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlayerPage } from '../src/features/player/PlayerPage';
import { PreferencesProvider } from '../src/state/PreferencesContext';
import type { AttachHlsOptions } from '../src/lib/hlsEngine';

const { attachMock } = vi.hoisted(() => ({ attachMock: vi.fn() }));

vi.mock('../src/lib/hlsEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/hlsEngine')>();
  return { ...actual, attachHlsEngine: attachMock };
});

const mockFetch = vi.fn();
const STORAGE_KEY = 'veyro.preferences.v1';

function mockStream(streamUrl: string) {
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ stream: { playable: true, streamUrl } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function setNativeHlsSupport(supported: boolean) {
  HTMLMediaElement.prototype.canPlayType = vi.fn((type: string) =>
    supported || !type.includes('mpegurl') ? 'probably' : '',
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
  // hls.js requires MediaSource; tests that exercise the hls engine stub it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaSource = class MediaSource {};

  attachMock.mockReset();
  attachMock.mockResolvedValue({
    levels: [],
    instance: {},
    setLevel: vi.fn(),
    destroy: vi.fn(),
  });

  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue('probably');
  HTMLMediaElement.prototype.load = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
    writable: true,
    configurable: true,
    value: false,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    writable: true,
    configurable: true,
    value: 1,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    writable: true,
    configurable: true,
    value: 0,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    writable: true,
    configurable: true,
    value: 0,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', {
    writable: true,
    configurable: true,
    value: 0,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', {
    writable: true,
    configurable: true,
    value: 0,
  });

  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.play = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.pause = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.canPlayType = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.load = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).videoWidth;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).videoHeight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).MediaSource;
});

function renderPlayer(withPreferences = false) {
  const tree = (
    <MemoryRouter initialEntries={['/player/channel/ch-1']}>
      <Routes>
        <Route path="/player/:kind/:id" element={<PlayerPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(withPreferences ? <PreferencesProvider>{tree}</PreferencesProvider> : tree);
}

async function waitForVideoElement(): Promise<HTMLVideoElement> {
  for (let index = 0; index < 80; index += 1) {
    const video = screen.queryByTestId('player-video');
    if (video) return video as HTMLVideoElement;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Video element not found');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function firstAttachOptions(): AttachHlsOptions {
  const call = attachMock.mock.calls[0];
  if (!call) throw new Error('hls.js was never attached');
  return call[0] as AttachHlsOptions;
}

describe('engine selection', () => {
  it('uses hls.js in Auto mode when native HLS is unavailable', async () => {
    setNativeHlsSupport(false);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer();
    const video = await waitForVideoElement();
    await flush();

    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(firstAttachOptions().url).toBe('https://stream.test/live.m3u8');
    expect(video.dataset.engine).toBe('hls');
    // hls.js owns the media element; no <source> may race with it.
    expect(video.querySelector('source')).toBeNull();
  });

  it('prefers native playback in Auto mode when the browser supports HLS', async () => {
    setNativeHlsSupport(true);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer();
    const video = await waitForVideoElement();
    await flush();

    expect(attachMock).not.toHaveBeenCalled();
    expect(video.dataset.engine).toBe('native');
    expect(video.querySelector('source')?.getAttribute('src')).toBe('https://stream.test/live.m3u8');
  });

  it('persists the engine choice through the preferredPlayer preference', async () => {
    setNativeHlsSupport(true);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer(true);
    await waitForVideoElement();

    fireEvent.click(screen.getByTestId('player-engine-menu'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /HLS\.js/ }));
    await flush();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      preferredPlayer?: string;
    };
    expect(stored.preferredPlayer).toBe('hls');
    expect(attachMock).toHaveBeenCalled();
  });

  it('ignores a stale shaka preference', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ preferredPlayer: 'shaka', fallbackPlayer: 'shaka' }),
    );
    setNativeHlsSupport(true);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer(true);
    const video = await waitForVideoElement();
    await flush();

    const menu = screen.getByTestId('player-engine-menu');
    expect(menu.getAttribute('aria-label')).toBe('Playback engine: Native');
    expect(video.dataset.engine).toBe('native');
    expect(document.body.textContent?.toLowerCase()).not.toContain('shaka');
  });
});

describe('hls.js failure handling', () => {
  it('falls back to native playback in Auto mode on a network/CORS failure', async () => {
    setNativeHlsSupport(false);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer();
    const video = await waitForVideoElement();
    await flush();

    const options = firstAttachOptions();
    await act(async () => {
      options.onFatalError?.({ kind: 'network', details: 'manifestLoadError' });
      await Promise.resolve();
    });
    await flush();

    expect(screen.getByRole('status').textContent).toContain('CORS');
    expect(video.dataset.engine).toBe('native');
    expect(video.querySelector('source')?.getAttribute('src')).toBe('https://stream.test/live.m3u8');
  });

  it('shows a clear error and keeps hls.js when the user picked it explicitly', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferredPlayer: 'hls' }));
    setNativeHlsSupport(true);
    mockStream('https://stream.test/live.m3u8');
    renderPlayer(true);
    const video = await waitForVideoElement();
    await flush();

    expect(video.dataset.engine).toBe('hls');

    const options = firstAttachOptions();
    await act(async () => {
      options.onFatalError?.({ kind: 'network', details: 'manifestLoadError' });
      await Promise.resolve();
    });

    expect(screen.getByText(/may block cross-origin playback \(CORS\)/)).toBeTruthy();
    // Native is offered as an explicit escape hatch rather than forced.
    expect(screen.getByRole('button', { name: /Use native player/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Use native player/ }));
    await flush();
    expect(video.dataset.engine).toBe('native');
  });
});
