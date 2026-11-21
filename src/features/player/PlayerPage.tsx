import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, MonitorPlay, RefreshCw, ShieldCheck } from 'lucide-react';
import { getChannelStream, getMovieStream, getEpisodeStream } from '../../lib/contentApi';

type PlayerKind = 'channel' | 'movie' | 'episode';

type PlayerState = 'loading' | 'connecting' | 'buffering' | 'playing' | 'failed';

interface StreamResolution {
  playable: boolean;
  streamUrl?: string;
  reason?: string;
}

/** Maximum time (ms) to wait for playback to start before treating it as a startup failure. */
const STARTUP_TIMEOUT_MS = 10_000;

/** Maximum number of automatic retry attempts after a playback failure. */
const MAX_RETRIES = 3;

/** Base delay (ms) for exponential backoff between automatic retries. */
const RETRY_BASE_DELAY_MS = 1_000;

export function PlayerPage() {
  const { id = '' } = useParams();

  const channelMatch = useMatch({ path: '/player/channel/:id' });
  const movieMatch = useMatch({ path: '/player/movie/:id' });
  const episodeMatch = useMatch({ path: '/player/episode/:id' });

  const kind: PlayerKind | null =
    channelMatch ? 'channel' : movieMatch ? 'movie' : episodeMatch ? 'episode' : null;
  const contentId =
    channelMatch?.params.id ?? movieMatch?.params.id ?? episodeMatch?.params.id ?? id;

  const [stream, setStream] = useState<StreamResolution | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const [apiError, setApiError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel all pending timers to avoid state updates after unmount or state transition. */
  const clearTimers = useCallback(() => {
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  // --- Stream resolution -----------------------------------------------------
  useEffect(() => {
    if (!kind || !contentId) {
      setApiError('Invalid player route.');
      setPlayerState('failed');
      return;
    }

    let active = true;
    setPlayerState('loading');
    setApiError(null);
    setPlayError(null);
    setRetryCount(0);

    const load = async () => {
      try {
        const result =
          kind === 'channel'
            ? await getChannelStream(contentId)
            : kind === 'movie'
              ? await getMovieStream(contentId)
              : await getEpisodeStream(contentId);
        if (!active) return;
        setStream(result.stream);
      } catch (caught) {
        if (!active) return;
        setApiError(caught instanceof Error ? caught.message : 'Could not resolve stream.');
        setPlayerState('failed');
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [kind, contentId]);

  // Transition from loading to connecting once a playable stream is available.
  useEffect(() => {
    if (stream?.playable && playerState === 'loading') {
      setPlayerState('connecting');
    }
  }, [stream, playerState]);

  // Transition from loading to failed when the stream is resolved but not playable
  // (e.g. Xtream providers where web playback is unsupported). This ensures the
  // "Web playback not supported" message is shown instead of being stuck in loading.
  useEffect(() => {
    if (stream && !stream.playable && playerState === 'loading') {
      setPlayerState('failed');
    }
  }, [stream, playerState]);

  // --- Startup timeout -------------------------------------------------------
  // Fires if playback does not reach the 'playing' state within the timeout
  // while in the 'connecting' state. Distinguishable from buffering because
  // buffering only applies after playback has started.
  useEffect(() => {
    if (playerState !== 'connecting') {
      if (startupTimeoutRef.current) {
        clearTimeout(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
      return;
    }

    startupTimeoutRef.current = setTimeout(() => {
      setPlayerState('failed');
      setPlayError('Stream failed to start within the timeout period.');
    }, STARTUP_TIMEOUT_MS);

    return () => {
      if (startupTimeoutRef.current) {
        clearTimeout(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
    };
  }, [playerState]);

  // --- Automatic retry with exponential backoff ------------------------------
  // Retries automatically up to MAX_RETRIES times. After that, only a manual
  // Retry action remains available. Backoff: 1s, 2s, 4s.
  useEffect(() => {
    if (playerState !== 'failed' || retryCount >= MAX_RETRIES) {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    const delay = RETRY_BASE_DELAY_MS * 2 ** retryCount;
    retryTimeoutRef.current = setTimeout(() => {
      if (playerState !== 'failed') return;
      attemptRetry();
    }, delay);

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState, retryCount]);

  // --- Video event handlers --------------------------------------------------
  const handlePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlayError(null);
    } catch {
      setPlayError('Autoplay was blocked by the browser. Click play to start.');
    }
  }, []);

  // Attempt autoplay when entering the connecting state. If the browser blocks
  // autoplay, the rejection is caught and a manual-start prompt is shown.
  useEffect(() => {
    if (playerState === 'connecting') {
      void handlePlay();
    }
  }, [playerState, handlePlay]);

  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const err = video.error;
    if (!err) {
      setPlayError('Playback failed.');
      setPlayerState('failed');
      return;
    }
    const messages: Record<number, string> = {
      1: 'Media playback was aborted.',
      2: 'Network error loading the stream.',
      3: 'The stream format is not supported by this browser.',
      4: 'The stream could not be decrypted or is not accessible.',
    };
    setPlayError(messages[err.code] ?? 'Playback failed.');
    setPlayerState('failed');
  }, []);

  const handleVideoWaiting = useCallback(() => {
    // The video has paused to buffer. Only mark buffering if we were
    // connecting or playing; an initial waiting before play has started is
    // still part of the startup phase and covered by the startup timeout.
    if (playerState === 'connecting' || playerState === 'playing') {
      setPlayerState('buffering');
    }
  }, [playerState]);

  const handleVideoPlaying = useCallback(() => {
    setPlayerState('playing');
    setPlayError(null);
  }, []);

  const attemptRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) return;
    const video = videoRef.current;
    if (!video) return;

    setRetryCount((prev) => prev + 1);
    setPlayError(null);
    setPlayerState('connecting');

    // Reload the video element to attempt recovery from a transient failure.
    video.load();
  }, [retryCount]);

  const handleManualRetry = useCallback(() => {
    setRetryCount(0);
    setPlayError(null);
    setPlayerState('connecting');
    const video = videoRef.current;
    if (video) {
      video.load();
    }
    // Re-attempt playback in case playerState was already 'connecting'
    // (the effect above only fires on state transitions).
    void handlePlay();
  }, [handlePlay]);

  // --- Render ----------------------------------------------------------------
  if (!kind) {
    return (
      <div className="inner-page phase-page">
        <div className="empty-state">
          <h1>Invalid player route</h1>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  if (playerState === 'loading') {
    return (
      <div className="inner-page player-page">
        <p className="provider-message">Resolving stream…</p>
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <AlertCircle size={32} />
          <h1>Stream unavailable</h1>
          <p>{apiError}</p>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  const resolution = stream;
  if (!resolution) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <h1>No stream data</h1>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  if (!resolution.playable) {
    return (
      <div className="inner-page player-page">
        <div className="empty-state">
          <AlertCircle size={32} />
          <h1>Web playback not supported</h1>
          <p>
            {resolution.reason === 'xtream_web_playback_unsupported'
              ? 'This provider requires native playback (Android/Android TV). Web browser playback is not available for Xtream providers.'
              : resolution.reason || 'This content cannot be played in the browser.'}
          </p>
          <p className="player-details__privacy">
            <ShieldCheck size={16} /> No provider credentials are exposed to the browser.
          </p>
          <Link to="/" className="button button--ghost">Return home</Link>
        </div>
      </div>
    );
  }

  const streamUrl = resolution.streamUrl!;
  const isHls = /\.m3u8([?#]|$)/i.test(streamUrl);

  const probe = (type: string) => {
    const video = document.createElement('video');
    return video.canPlayType(type) !== '';
  };
  const canPlay = isHls ? probe('application/vnd.apple.mpegurl') : probe('video/mp4');

  const autoRetryAvailable = retryCount < MAX_RETRIES;

  return (
    <div className="player-page">
      <div className="player-frame">
        <Link to="/" className="button button--quiet" aria-label="Exit player">
          <ArrowLeft size={18} /> Exit player
        </Link>
        <span className="badge badge--neutral">
          <MonitorPlay size={14} /> Direct provider stream
        </span>
        <div className="player-frame__center">
          {canPlay ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                onError={handleVideoError}
                onWaiting={handleVideoWaiting}
                onPlaying={handleVideoPlaying}
                className="player-video" data-testid="player-video"
                onPlay={() => setPlayError(null)}
              >
                <source src={streamUrl} />
              </video>
              {playerState === 'buffering' && (
                <div className="player-buffering">
                  <AlertCircle size={24} />
                  <p>Buffering…</p>
                </div>
              )}
            </>
          ) : null}
          {!canPlay && !playError ? (
            <div className="player-frame__unsupported">
              <AlertCircle size={32} />
              <h2>Stream format not supported</h2>
              <p>
                {isHls
                  ? 'This browser cannot play HLS (.m3u8) streams natively.'
                  : 'This browser cannot play this stream format natively.'}
              </p>
              <p>Use the Veyro native app on Android/Android TV for direct provider playback.</p>
            </div>
          ) : null}
          {playError && (
            <div className="player-error">
              <p>{playError}</p>
              <button
                type="button"
                className="button button--primary"
                onClick={handleManualRetry}
              >
                <RefreshCw size={18} />
                {playError.includes('blocked') ? 'Click to Play' : 'Retry Playback'}
              </button>
              {!autoRetryAvailable && (
                <p className="player-error__terminal">
                  Automatic retries exhausted. Try again manually when ready.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
