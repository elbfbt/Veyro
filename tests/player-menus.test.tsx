// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlayerPage } from '../src/features/player/PlayerPage';

const mockFetch = vi.fn();

function mockStream(streamUrl: string) {
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ stream: { playable: true, streamUrl } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;

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

function renderPlayer(kind: 'channel' | 'movie', id: string) {
  return render(
    <MemoryRouter initialEntries={[`/player/${kind}/${id}`]}>
      <Routes>
        <Route path="/player/:kind/:id" element={<PlayerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForVideoElement(): Promise<HTMLVideoElement> {
  for (let index = 0; index < 50; index += 1) {
    const video = screen.queryByTestId('player-video');
    if (video) return video as HTMLVideoElement;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Video element not found');
}

describe('PlayerPage quality menu', () => {
  it('explains that manual quality is unavailable for native playback', async () => {
    mockStream('https://stream.test/movie.mp4');
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();

    const trigger = screen.getByTestId('player-quality-menu');
    fireEvent.click(trigger);

    const list = screen.getByTestId('player-quality-menu-list');
    expect(list.textContent).toContain('Adaptive quality unavailable with this engine');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the native resolution once the element reports it', async () => {
    mockStream('https://stream.test/movie.mp4');
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();

    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    const trigger = screen.getByTestId('player-quality-menu');
    expect(trigger.getAttribute('aria-label')).toBe('Quality: 1080p');

    fireEvent.click(trigger);
    expect(screen.getByTestId('player-quality-menu-list').textContent).toContain('1080p');
  });

  it('closes the menu with Escape', async () => {
    mockStream('https://stream.test/movie.mp4');
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();

    fireEvent.click(screen.getByTestId('player-quality-menu'));
    expect(screen.queryByTestId('player-quality-menu-list')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByTestId('player-quality-menu-list')).toBeNull();
  });
});

describe('PlayerPage engine selector', () => {
  it('is hidden for MP4 playback and never mentions shaka', async () => {
    mockStream('https://stream.test/movie.mp4');
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();

    expect(screen.queryByTestId('player-engine-menu')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('shaka');
  });

  it('lists only implemented engines for HLS streams', async () => {
    // hls.js needs MediaSource; pretend the browser provides it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaSource = class MediaSource {};
    mockStream('https://stream.test/channel.m3u8');
    renderPlayer('channel', 'ch-1');

    // Wait for capability detection to render the engine menu.
    let trigger: HTMLElement | null = null;
    for (let index = 0; index < 50 && !trigger; index += 1) {
      trigger = screen.queryByTestId('player-engine-menu');
      if (!trigger) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(trigger).not.toBeNull();

    fireEvent.click(trigger!);
    const labels = screen
      .getByTestId('player-engine-menu-list')
      .querySelectorAll('[role="menuitemradio"]');
    const text = Array.from(labels).map((node) => node.textContent);
    expect(text).toEqual(['Auto', 'Native HTML5', 'HLS.js']);
  });
});
