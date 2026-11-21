// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlayerPage } from '../src/features/player/PlayerPage';

const mockFetch = vi.fn() as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

async function mockStreamResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('PlayerPage stream loading', () => {
  it('loads and renders an M3U channel stream', async () => {
    mockStreamResponse({
      stream: { playable: true, streamUrl: 'https://stream.test/channel.m3u8' },
    });

    renderPlayer('channel', 'ch-1');

    await waitFor(() => {
      expect(screen.getByText('Direct provider stream')).toBeTruthy();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/channels/ch-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('loads and renders an M3U movie stream', async () => {
    mockStreamResponse({
      stream: { playable: true, streamUrl: 'https://stream.test/movie.mp4' },
    });

    renderPlayer('movie', 'mv-1');

    await waitFor(() => {
      expect(screen.getByText('Direct provider stream')).toBeTruthy();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/movies/mv-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('loads and renders an M3U episode stream', async () => {
    mockStreamResponse({
      stream: { playable: true, streamUrl: 'https://stream.test/episode.m3u8' },
    });

    renderPlayer('episode', 'ep-1');

    await waitFor(() => {
      expect(screen.getByText('Direct provider stream')).toBeTruthy();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/episodes/ep-1/stream',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});

describe('PlayerPage Xtream unsupported', () => {
  it('shows web playback unsupported for Xtream channel', async () => {
    mockStreamResponse({
      stream: { playable: false, reason: 'xtream_web_playback_unsupported' },
    });

    renderPlayer('channel', 'ch-xtream');

    await waitFor(() => {
      expect(screen.getByText('Web playback not supported')).toBeTruthy();
    });

    expect(
      screen.getByText(
        'This provider requires native playback (Android/Android TV). Web browser playback is not available for Xtream providers.',
      ),
    ).toBeTruthy();

    expect(
      screen.getByText('No provider credentials are exposed to the browser.'),
    ).toBeTruthy();
  });

  it('shows web playback unsupported for Xtream movie', async () => {
    mockStreamResponse({
      stream: { playable: false, reason: 'xtream_web_playback_unsupported' },
    });

    renderPlayer('movie', 'mv-xtream');

    await waitFor(() => {
      expect(screen.getByText('Web playback not supported')).toBeTruthy();
    });

    expect(
      screen.getByText('No provider credentials are exposed to the browser.'),
    ).toBeTruthy();
  });

  it('shows web playback unsupported for Xtream episode', async () => {
    mockStreamResponse({
      stream: { playable: false, reason: 'xtream_web_playback_unsupported' },
    });

    renderPlayer('episode', 'ep-xtream');

    await waitFor(() => {
      expect(screen.getByText('Web playback not supported')).toBeTruthy();
    });

    expect(
      screen.getByText('No provider credentials are exposed to the browser.'),
    ).toBeTruthy();
  });
});

describe('PlayerPage errors', () => {
  it('shows stream unavailable when API resolves to error', async () => {
    mockStreamResponse({ error: 'not_found', message: 'Content not found.' }, 404);

    renderPlayer('channel', 'nonexistent');

    await waitFor(() => {
      expect(screen.getByText('Stream unavailable')).toBeTruthy();
    });
  });

  it('shows unsupported format when browser cannot play the stream type', async () => {
    mockStreamResponse({
      stream: { playable: true, streamUrl: 'https://stream.test/unknown.xyz' },
    });

    renderPlayer('channel', 'ch-1');

    await waitFor(() => {
      expect(screen.getByText('Stream format not supported')).toBeTruthy();
    });
  });
});
