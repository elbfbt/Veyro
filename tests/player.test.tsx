// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlayerPage } from '../src/features/player/PlayerPage';

const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRIES = 3;
const STARTUP_TIMEOUT_MS = 10_000;

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;

  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue('probably');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.play = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.canPlayType = undefined as any;
});

function renderPlayer(kind: 'channel' | 'movie' | 'episode', id: string) {
  return render(
    <MemoryRouter initialEntries={[`/player/${kind}/${id}`]}>
      <Routes>
        <Route path="/player/:kind/:id" element={<PlayerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Poll for the video element to appear (handles React async rendering). */
async function waitForVideoElement() {
  for (let i = 0; i < 50; i++) {
    const video = screen.queryByTestId('player-video');
    if (video) return video as HTMLVideoElement;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Video element not found');
}

/** Poll for text to appear in the DOM (handles React async rendering). */
async function waitForText(text: string) {
  for (let i = 0; i < 50; i++) {
    const el = screen.queryByText(text);
    if (el) return el;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Text not found: ${text}`);
}

function dispatchVideoEvent(video: HTMLVideoElement, type: string) {
  act(() => {
    video.dispatchEvent(new Event(type));
  });
}

describe('PlayerPage playback initialization', () => {
  it('creates a video element with the correct stream URL for M3U content', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    expect(video.querySelector('source')?.src).toBe('https://stream.test/channel.m3u8');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/channels/ch-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('creates a video element with the correct stream URL for MP4 content', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    expect(video.querySelector('source')?.src).toBe('https://stream.test/movie.mp4');
  });

  it('calls the correct stream endpoint for movie', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/movies/mv-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('calls the correct stream endpoint for episode', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/episode.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('episode', 'ep-1');
    await waitForVideoElement();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/episodes/ep-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});

describe('PlayerPage loading states', () => {
  it('shows loading state while resolving stream', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockReturnValue(fetchPromise);

    renderPlayer('channel', 'ch-1');
    expect(screen.getByText('Resolving stream…')).toBeTruthy();

    resolveFetch(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const video = await waitForVideoElement();
    expect(video).toBeTruthy();
  });
});

describe('PlayerPage buffering state', () => {
  it('shows buffering state when waiting event fires', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    dispatchVideoEvent(video, 'waiting');
    await waitForVideoElement();
    expect(screen.getByText('Buffering…')).toBeTruthy();
  });

  it('transitions back to playing when playing event fires after buffering', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    dispatchVideoEvent(video, 'waiting');
    await waitForVideoElement();
    expect(screen.getByText('Buffering…')).toBeTruthy();
    const video2 = await waitForVideoElement();
    dispatchVideoEvent(video2, 'playing');
    await waitForVideoElement();
    expect(screen.queryByText('Buffering…')).toBeNull();
  });
});

describe('PlayerPage error handling', () => {
  it('handles normal HTML5 media errors', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    Object.defineProperty(video, 'error', {
      value: { code: 2, message: 'Network error' },
      configurable: true,
    });
    dispatchVideoEvent(video, 'error');
    expect(screen.getByText('Network error loading the stream.')).toBeTruthy();
  });

  it('handles media error code 3 (format not supported)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    Object.defineProperty(video, 'error', {
      value: { code: 3, message: 'Format not supported' },
      configurable: true,
    });
    dispatchVideoEvent(video, 'error');
    expect(screen.getByText('The stream format is not supported by this browser.')).toBeTruthy();
  });
});

describe('PlayerPage startup timeout', () => {
  it('transitions to failed state when startup timeout is reached', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    await act(async () => { await Promise.resolve(); });
    const video = screen.getByTestId('player-video');
    expect(video).toBeTruthy();
    vi.advanceTimersByTime(STARTUP_TIMEOUT_MS + 100);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Stream failed to start within the timeout period.')).toBeTruthy();
    vi.useRealTimers();
  });

  it('does not time out if playback starts before the timeout', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    dispatchVideoEvent(video, 'playing');
    await waitForVideoElement();
    // Playback started before timeout, so no timeout message should appear
    expect(screen.queryByText('Stream failed to start within the timeout period.')).toBeNull();
  });
});

describe('PlayerPage retry behavior', () => {
  it('retries playback when manual retry is clicked', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    Object.defineProperty(video, 'error', {
      value: { code: 2, message: 'Network error' },
      configurable: true,
    });
    dispatchVideoEvent(video, 'error');
    expect(screen.getByText('Network error loading the stream.')).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: /retry playback/i });
    expect(retryButton).toBeTruthy();
    fireEvent.click(retryButton);
    const video2 = await waitForVideoElement();
    expect(video2).toBeTruthy();
  });

  it('shows terminal message after max retries exhausted', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    await act(async () => { await Promise.resolve(); });
    let currentVideo = screen.getByTestId('player-video') as HTMLVideoElement;
    expect(currentVideo).toBeTruthy();
    for (let i = 0; i < MAX_RETRIES; i++) {
      Object.defineProperty(currentVideo, 'error', {
        value: { code: 2, message: 'Network error loading the stream.' },
        configurable: true,
      });
      dispatchVideoEvent(currentVideo, 'error');
      expect(screen.getByText('Network error loading the stream.')).toBeTruthy();
      vi.advanceTimersByTime(RETRY_BASE_DELAY_MS * 2 ** i);
      await act(async () => { await Promise.resolve(); });
      currentVideo = screen.getByTestId('player-video') as HTMLVideoElement;
    }
    // After MAX_RETRIES automatic retries, retryCount === MAX_RETRIES so
    // autoRetryAvailable is false. Dispatch one more error to show terminal msg.
    Object.defineProperty(currentVideo, 'error', {
      value: { code: 2, message: 'Network error loading the stream.' },
      configurable: true,
    });
    dispatchVideoEvent(currentVideo, 'error');
    expect(screen.getByText('Automatic retries exhausted. Try again manually when ready.')).toBeTruthy();
    vi.useRealTimers();
  });

  it('manual retry resets retry count and attempts playback again', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    Object.defineProperty(video, 'error', {
      value: { code: 2, message: 'Network error loading the stream.' },
      configurable: true,
    });
    dispatchVideoEvent(video, 'error');
    expect(screen.getByText('Network error loading the stream.')).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: /retry playback/i });
    fireEvent.click(retryButton);
    expect(screen.queryByText('Network error loading the stream.')).toBeNull();
    const video2 = await waitForVideoElement();
    expect(video2).toBeTruthy();
  });
});

describe('PlayerPage autoplay rejection', () => {
  it('handles autoplay rejection gracefully and allows manual start', async () => {
    HTMLMediaElement.prototype.play = vi.fn().mockImplementation(() => Promise.reject(new Error('Autoplay blocked')));
    HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue('probably');
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    // Initial autoplay rejection: handlePlay catches video.play() rejection,
    // shows "Click to Play" prompt instead of crashing.
    await waitForText('Click to Play');
    expect(video.play).toHaveBeenCalled();
    // Manual retry re-triggers handlePlay
    fireEvent.click(screen.getByRole('button', { name: /click to play/i }));
    await act(async () => {});
    expect(video.play).toHaveBeenCalledTimes(2);
  });
});

describe('PlayerPage Xtream unsupported', () => {
  it('shows web playback unsupported for Xtream channel', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: false, reason: 'xtream_web_playback_unsupported' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-xtream');
    expect(screen.queryByTestId('player-video')).toBeNull();
    await waitForText('Web playback not supported');
    expect(screen.getByText(
      'This provider requires native playback (Android/Android TV). Web browser playback is not available for Xtream providers.',
    )).toBeTruthy();
    expect(screen.getByText('No provider credentials are exposed to the browser.')).toBeTruthy();
  });

  it('shows web playback unsupported for Xtream movie', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: false, reason: 'xtream_web_playback_unsupported' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-xtream');
    await waitForText('Web playback not supported');
    expect(screen.getByText('No provider credentials are exposed to the browser.')).toBeTruthy();
  });

  it('shows web playback unsupported for Xtream episode', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: false, reason: 'xtream_web_playback_unsupported' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('episode', 'ep-xtream');
    await waitForText('Web playback not supported');
    expect(screen.getByText('No provider credentials are exposed to the browser.')).toBeTruthy();
  });
});

describe('PlayerPage errors', () => {
  it('shows stream unavailable when API resolves to error', async () => {
    const error = new Error('Content not found.') as Error & { status: number };
    error.status = 404;
    mockFetch.mockRejectedValue(error);
    renderPlayer('channel', 'nonexistent');
    await waitForText('Stream unavailable');
  });

  it('shows unsupported format when browser cannot play the stream type', async () => {
    HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue('');
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    await waitForText('Stream format not supported');
  });
});
