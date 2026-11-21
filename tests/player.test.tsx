// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlayerPage } from '../src/features/player/PlayerPage';

const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRIES = 3;
const STARTUP_TIMEOUT_MS = 10_000;
const CONTROLS_HIDE_DELAY_MS = 3_000;

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;

  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue('probably');
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLMediaElement.prototype as any).requestPictureInPicture = vi.fn().mockResolvedValue(undefined);

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
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    writable: true,
    configurable: true,
    value: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'seekable', {
    writable: true,
    configurable: true,
    value: { length: 1, start: () => 0, end: () => 3600 },
  });

  Object.defineProperty(document, 'fullscreenEnabled', {
    writable: true,
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    writable: true,
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.play = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.pause = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.canPlayType = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.load = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLMediaElement.prototype.requestFullscreen = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLMediaElement.prototype as any).requestPictureInPicture = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).muted;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).volume;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).currentTime;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).duration;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).paused;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (HTMLMediaElement.prototype as any).seekable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (document as any).fullscreenEnabled;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (document as any).pictureInPictureEnabled;
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

function setVideoSeekable(video: HTMLVideoElement, seekable: boolean) {
  Object.defineProperty(video, 'seekable', {
    writable: true,
    configurable: true,
    value: seekable ? { length: 1, start: () => 0, end: () => 3600 } : { length: 0 },
  });
}

function setVideoDuration(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, 'duration', {
    writable: true,
    configurable: true,
    value: seconds,
  });
}

function setVideoCurrentTime(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, 'currentTime', {
    writable: true,
    configurable: true,
    value: seconds,
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
    // Autoplay rejection: handlePlay catches video.play() rejection,
    // shows play button in controls instead of an error overlay.
    expect(video.play).toHaveBeenCalled();
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    // Manual retry re-triggers handlePlay
    fireEvent.click(screen.getByTestId('player-btn-play'));
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

// ============================================================================
// Phase 5C — Player Controls
// ============================================================================

describe('PlayerPage play/pause', () => {
  it('toggles play when play button is clicked', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    expect(video.play).toHaveBeenCalled();
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    fireEvent.click(screen.getByTestId('player-btn-play'));
    await act(async () => {});
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it('shows pause button when video is playing', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    dispatchVideoEvent(video, 'playing');
    await act(async () => {});
    expect(screen.queryByTestId('player-btn-play')).toBeTruthy();
    const btn = screen.getByTestId('player-btn-play');
    expect(btn).toBeTruthy();
  });
});

describe('PlayerPage mute/volume', () => {
  it('toggles mute when mute button is clicked', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    expect(screen.getByTestId('player-btn-mute')).toBeTruthy();
    fireEvent.click(screen.getByTestId('player-btn-mute'));
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByTestId('player-btn-mute'));
    expect(video.muted).toBe(false);
  });

  it('changes volume when volume slider is moved', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    const volumeInput = screen.getByTestId('player-volume');
    fireEvent.input(volumeInput, { target: { value: '0.5' } });
    expect(video.volume).toBe(0.5);
    expect(video.muted).toBe(false);
  });
});

describe('PlayerPage seek', () => {
  it('seeks when progress bar is moved for seekable content', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    setVideoDuration(video, 3600);
    setVideoCurrentTime(video, 0);
    dispatchVideoEvent(video, 'loadedmetadata');
    await act(async () => {});
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    const progressInput = screen.getByTestId('player-progress');
    fireEvent.input(progressInput, { target: { value: '50' } });
    expect(video.currentTime).toBe(1800);
  });

  it('does not show progress bar for non-seekable live streams', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    const video = await waitForVideoElement();
    setVideoSeekable(video, false);
    dispatchVideoEvent(video, 'loadedmetadata');
    await act(async () => {});
    // No progress bar for live streams
    expect(screen.queryByTestId('player-progress')).toBeNull();
    expect(screen.getByTestId('player-volume')).toBeTruthy();
  });
});

describe('PlayerPage live vs VOD', () => {
  it('shows LIVE indicator for channel streams', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('channel', 'ch-1');
    await waitForVideoElement();
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText('Live TV')).toBeTruthy();
  });

  it('shows movie label for movie streams', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(screen.getByText('Movie')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows episode label for episode streams', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/episode.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('episode', 'ep-1');
    await waitForVideoElement();
    expect(screen.getByText('Episode')).toBeTruthy();
  });
});

describe('PlayerPage fullscreen', () => {
  it('enters fullscreen when fullscreen button is clicked', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    const btn = screen.getByTestId('player-btn-fullscreen');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(HTMLMediaElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it('does not show fullscreen button when unsupported', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      writable: true,
      configurable: true,
      value: false,
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(screen.queryByTestId('player-btn-fullscreen')).toBeNull();
  });
});

describe('PlayerPage picture-in-picture', () => {
  it('enters PiP when PiP button is clicked', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    const btn = screen.getByTestId('player-btn-pip');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(video.requestPictureInPicture).toHaveBeenCalled();
  });

  it('does not show PiP button when unsupported', async () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      writable: true,
      configurable: true,
      value: false,
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(screen.queryByTestId('player-btn-pip')).toBeNull();
  });
});

describe('PlayerPage controls visibility', () => {
  it('controls are visible initially', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    expect(screen.getByTestId('player-btn-mute')).toBeTruthy();
  });

  it('controls hide after inactivity while playing', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await act(async () => { await Promise.resolve(); });
    const video = screen.getByTestId('player-video') as HTMLVideoElement;
    dispatchVideoEvent(video, 'playing');
    await act(async () => { await Promise.resolve(); });
    // Controls should be visible initially
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    // Advance past the hide delay
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('player-btn-play')).toBeNull();
    vi.useRealTimers();
  });

  it('controls reappear after pointer interaction', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await act(async () => { await Promise.resolve(); });
    const video = screen.getByTestId('player-video') as HTMLVideoElement;
    dispatchVideoEvent(video, 'playing');
    await act(async () => { await Promise.resolve(); });
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('player-btn-play')).toBeNull();
    // Simulate pointer move
    fireEvent.pointerMove(screen.getByTestId('player-video'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    vi.useRealTimers();
  });

  it('controls remain visible when paused', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    dispatchVideoEvent(video, 'playing');
    await act(async () => {});
    dispatchVideoEvent(video, 'pause');
    await act(async () => {});
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
  });
});

describe('PlayerPage keyboard shortcuts', () => {
  it('toggles play/pause with Space key', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    expect(video.play).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: ' ' });
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it('seeks backward with ArrowLeft', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    setVideoDuration(video, 3600);
    setVideoCurrentTime(video, 600);
    dispatchVideoEvent(video, 'loadedmetadata');
    await act(async () => {});
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(590);
  });

  it('seeks forward with ArrowRight', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    setVideoDuration(video, 3600);
    setVideoCurrentTime(video, 600);
    dispatchVideoEvent(video, 'loadedmetadata');
    await act(async () => {});
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(610);
  });

  it('toggles mute with M key', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    const video = await waitForVideoElement();
    fireEvent.keyDown(document, { key: 'm' });
    expect(video.muted).toBe(true);
  });
});

describe('PlayerPage accessibility', () => {
  it('has aria-labels on all control buttons', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    expect(screen.getByTestId('player-btn-play').getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByTestId('player-btn-mute').getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByTestId('player-btn-pip').getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByTestId('player-btn-fullscreen').getAttribute('aria-label')).toBeTruthy();
  });

  it('play button has correct aria-label when paused', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await waitForVideoElement();
    const btn = screen.getByTestId('player-btn-play');
    expect(btn.getAttribute('aria-label')).toBe('Play');
  });
});

describe('PlayerPage mobile/touch', () => {
  it('shows controls after touch interaction', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    renderPlayer('movie', 'mv-1');
    await act(async () => { await Promise.resolve(); });
    const video = screen.getByTestId('player-video') as HTMLVideoElement;
    dispatchVideoEvent(video, 'playing');
    await act(async () => { await Promise.resolve(); });
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('player-btn-play')).toBeNull();
    fireEvent.touchStart(video);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('player-btn-play')).toBeTruthy();
    vi.useRealTimers();
  });
});
