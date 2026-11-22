import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Gauge,
  Maximize,
  Minimize,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getChannelStream, getMovieStream, getEpisodeStream } from '../../lib/contentApi';
import {
  attachHlsEngine,
  resetMediaElement,
  type HlsEngineHandle,
  type HlsFatalErrorKind,
} from '../../lib/hlsEngine';
import {
  availableEngines,
  describeQualityOptions,
  formatQualityLabel,
  isHlsUrl,
  nativeQualityLabel,
  normalizeEnginePreference,
  QUALITY_UNAVAILABLE_NATIVE,
  resolveEngine,
  shouldFallbackToNative,
  type EnginePreference,
  type PlaybackEngine,
  type QualityLevel,
} from '../../lib/playerEngine';
import { useOptionalPreferences } from '../../state/PreferencesContext';
import { PlayerMenu, type PlayerMenuItem } from './PlayerMenus';

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

/** Delay (ms) before auto-hiding controls after the last interaction while playing. */
const CONTROLS_HIDE_DELAY_MS = 3_000;

/** Seconds to seek backward/forward with arrow keys. */
const SEEK_OFFSET_SECONDS = 10;

/** Format seconds as M:SS or H:MM:SS. */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const time = `${minutes}:${secs.toString().padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${time}` : time;
}

export function PlayerPage() {
  const { id = '' } = useParams();

  const channelMatch = useMatch({ path: '/player/channel/:id' });
  const movieMatch = useMatch({ path: '/player/movie/:id' });
  const episodeMatch = useMatch({ path: '/player/episode/:id' });

  const kind: PlayerKind | null =
    channelMatch ? 'channel' : movieMatch ? 'movie' : episodeMatch ? 'episode' : null;
  const contentId =
    channelMatch?.params.id ?? movieMatch?.params.id ?? episodeMatch?.params.id ?? id;

  const isLive = kind === 'channel';

  // --- Stream resolution state ---
  const [stream, setStream] = useState<StreamResolution | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const [apiError, setApiError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // --- Controls state ---
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [isSeekable, setIsSeekable] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  // --- Playback engine state ---
  const preferences = useOptionalPreferences();
  const [nativeHlsSupported, setNativeHlsSupported] = useState(false);
  const [hlsJsSupported, setHlsJsSupported] = useState(false);
  const [engineOverride, setEngineOverride] = useState<PlaybackEngine | null>(null);
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [attachNonce, setAttachNonce] = useState(0);
  const [hlsLevels, setHlsLevels] = useState<QualityLevel[]>([]);
  const [hlsActiveLevel, setHlsActiveLevel] = useState(-1);
  const [hlsAuto, setHlsAuto] = useState(true);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | null>(null);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsHandleRef = useRef<HlsEngineHandle | null>(null);
  const resumeTimeRef = useRef<number | null>(null);
  const failureHandlerRef = useRef<(kind: HlsFatalErrorKind) => void>(() => {});

  /**
   * Keep the ref and a state copy of the mounted element in sync. The engine
   * effects need a dependency that changes when the <video> first mounts,
   * because it only renders once the stream has been resolved.
   */
  const attachVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setMediaElement(node);
  }, []);

  // --- Resolved playback engine --------------------------------------------
  // Only HLS offers a choice of engine; MP4 and other formats always use the
  // browser's native pipeline.
  const activeStreamUrl = stream?.playable ? (stream.streamUrl ?? null) : null;
  const hasHlsStream = activeStreamUrl ? isHlsUrl(activeStreamUrl) : false;
  const enginePreference: EnginePreference = normalizeEnginePreference(
    preferences?.preferences.preferredPlayer,
  );
  const preferredEngine: PlaybackEngine = hasHlsStream
    ? resolveEngine(enginePreference, {
        nativeHls: nativeHlsSupported,
        hlsJs: hlsJsSupported,
      })
    : 'native';
  const engine: PlaybackEngine = hasHlsStream && engineOverride ? engineOverride : preferredEngine;

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
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  // --- Controls timer helpers ---
  const stopControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const startControlsTimer = useCallback(() => {
    stopControlsTimer();
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [stopControlsTimer]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    stopControlsTimer();
    if (playerState === 'playing') {
      startControlsTimer();
    }
  }, [playerState, startControlsTimer, stopControlsTimer]);

  // --- Video event handlers ---
  const handlePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlayError(null);
    } catch {
      // Autoplay or retry was blocked by the browser. Treat as a manual-start
      // prompt rather than a broken stream: show the play button in controls.
      setPlayError(null);
      setIsPaused(true);
    }
  }, []);

  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // Browsers fire an aborted-load error while engines swap and the element is
    // momentarily empty; that is not a stream failure.
    if (!video.currentSrc && !video.getAttribute('src') && !video.querySelector('source')) return;
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
    if (playerState === 'connecting' || playerState === 'playing') {
      setPlayerState('buffering');
    }
  }, [playerState]);

  const handleVideoPlaying = useCallback(() => {
    setPlayerState('playing');
    setPlayError(null);
    setControlsVisible(true);
    startControlsTimer();
  }, [startControlsTimer]);

  const handleVideoLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setCurrentTime(video.currentTime);
    setIsSeekable(video.seekable && video.seekable.length > 0);
    setIsPaused(video.paused);
    setVideoSize({ width: video.videoWidth ?? 0, height: video.videoHeight ?? 0 });
  }, []);

  const handleVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    setDuration(video.duration);
    setIsSeekable(video.seekable && video.seekable.length > 0);
  }, []);

  const handleVideoPlay = useCallback(() => {
    setIsPaused(false);
    setPlayError(null);
    showControls();
  }, [showControls]);

  const handleVideoPause = useCallback(() => {
    setIsPaused(true);
    setControlsVisible(true);
    stopControlsTimer();
  }, [stopControlsTimer]);

  // --- Control handlers ---
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video
        .play()
        .catch(() => setPlayError('Could not start playback. Try again.'));
    } else {
      video.pause();
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    video.muted = newMuted;
    if (!newMuted) {
      video.volume = volume;
    }
    showControls();
  }, [isMuted, volume, showControls]);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    setIsMuted(false);
    setVolume(value);
    video.muted = false;
    video.volume = value;
    showControls();
  }, [showControls]);

  const handleSeek = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (duration > 0) {
      video.currentTime = (value / 100) * duration;
    }
    setCurrentTime((value / 100) * duration);
    showControls();
  }, [duration, showControls]);

  const handleToggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isFullscreen) {
      void video.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  }, [isFullscreen]);

  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (!isPip) {
        await video.requestPictureInPicture();
      } else {
        await document.exitPictureInPicture();
      }
    } catch {
      // PiP unavailable or failed — silently ignore.
    }
  }, [isPip]);

  const handleAttemptRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) return;
    const video = videoRef.current;
    if (!video) return;

    setRetryCount((prev) => prev + 1);
    setPlayError(null);
    setPlayerState('connecting');

    // hls.js owns the media element; re-attaching happens through attachNonce.
    if (engine !== 'hls') video.load();
    setAttachNonce((nonce) => nonce + 1);
  }, [engine, retryCount]);

  const handleManualRetry = useCallback(() => {
    setRetryCount(0);
    setPlayError(null);
    setPlayerState('connecting');
    const video = videoRef.current;
    if (video && engine !== 'hls') {
      video.load();
    }
    setAttachNonce((nonce) => nonce + 1);
    void handlePlay();
  }, [engine, handlePlay]);

  // --- Playback engine ---------------------------------------------------------

  // Detect what this browser can actually do once, on mount.
  useEffect(() => {
    const probeVideo = document.createElement('video');
    setNativeHlsSupported(probeVideo.canPlayType('application/vnd.apple.mpegurl') !== '');
    setHlsJsSupported(typeof MediaSource !== 'undefined');
  }, []);

  /** Route hls.js failures to the UI, falling back to native in Auto mode. */
  const handleEngineFailure = useCallback(
    (kind: HlsFatalErrorKind) => {
      if (
        shouldFallbackToNative(enginePreference, kind, {
          nativeHls: nativeHlsSupported,
          hlsJs: hlsJsSupported,
        })
      ) {
        // hls.js needs the provider to allow cross-origin requests; native
        // playback does not, so Auto mode recovers by switching engines.
        setEngineOverride('native');
        setEngineNotice(
          kind === 'network'
            ? 'HLS.js could not load this stream — the provider may not allow cross-origin playback (CORS). Using native playback instead.'
            : 'HLS.js is unavailable for this stream. Using native playback instead.',
        );
        setPlayError(null);
        setPlayerState('connecting');
        setAttachNonce((nonce) => nonce + 1);
        return;
      }

      setPlayError(
        kind === 'unavailable'
          ? 'The HLS.js engine could not be loaded and this browser cannot play HLS natively.'
          : kind === 'media'
            ? 'HLS.js could not decode this stream.'
            : 'HLS.js could not load this stream. The provider may block cross-origin playback (CORS).',
      );
      setPlayerState('failed');
    },
    [enginePreference, hlsJsSupported, nativeHlsSupported],
  );

  useEffect(() => {
    failureHandlerRef.current = handleEngineFailure;
  }, [handleEngineFailure]);

  // Attach hls.js when it is the resolved engine. The cleanup fully tears the
  // instance down before any other engine can take over the media element.
  useEffect(() => {
    if (engine !== 'hls' || !hasHlsStream || !activeStreamUrl) return;
    const video = mediaElement;
    if (!video) return;

    let disposed = false;
    void attachHlsEngine({
      video,
      url: activeStreamUrl,
      restoreTime: isLive ? null : resumeTimeRef.current,
      onLevels: (levels) => {
        if (!disposed) setHlsLevels(levels);
      },
      onLevelSwitch: ({ level, auto }) => {
        if (disposed) return;
        setHlsActiveLevel(level);
        setHlsAuto(auto);
      },
      onFatalError: ({ kind }) => {
        if (!disposed) failureHandlerRef.current(kind);
      },
    }).then((handle) => {
      if (disposed) {
        handle?.destroy();
        return;
      }
      hlsHandleRef.current = handle;
    });

    return () => {
      disposed = true;
      hlsHandleRef.current?.destroy();
      hlsHandleRef.current = null;
      resetMediaElement(video);
      setHlsLevels([]);
      setHlsActiveLevel(-1);
      setHlsAuto(true);
    };
  }, [engine, hasHlsStream, activeStreamUrl, attachNonce, isLive, mediaElement]);

  // Native playback renders its <source> in JSX; reload after an engine switch
  // (or retry) and restore the previous position for VOD.
  useEffect(() => {
    if (engine !== 'native' || !activeStreamUrl) return;
    const video = mediaElement;
    if (!video) return;

    try {
      video.load();
    } catch {
      // Environments without a working media pipeline (tests) have nothing to load.
    }

    const restore = isLive ? null : resumeTimeRef.current;
    if (typeof restore !== 'number' || !Number.isFinite(restore) || restore <= 0) return;

    const onLoaded = () => {
      try {
        video.currentTime = restore;
      } catch {
        // Seek rejected by the browser; playback simply starts at the beginning.
      }
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [engine, activeStreamUrl, attachNonce, isLive, mediaElement]);

  // A new stream starts with a clean engine choice.
  useEffect(() => {
    setEngineOverride(null);
    setEngineNotice(null);
    resumeTimeRef.current = null;
  }, [activeStreamUrl]);

  const selectEngine = useCallback(
    (next: EnginePreference) => {
      const video = videoRef.current;
      const position = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
      resumeTimeRef.current = !isLive && position > 0 ? position : null;
      setEngineOverride(next === 'auto' ? null : next);
      preferences?.update('preferredPlayer', next);
      setEngineNotice(null);
      setPlayError(null);
      setRetryCount(0);
      setPlayerState('connecting');
      setAttachNonce((nonce) => nonce + 1);
    },
    [isLive, preferences],
  );

  const selectQuality = useCallback((levelIndex: number) => {
    hlsHandleRef.current?.setLevel(levelIndex);
    setHlsAuto(levelIndex === -1);
    if (levelIndex >= 0) setHlsActiveLevel(levelIndex);
  }, []);

  // --- Interaction handlers (controls visibility) ---
  const handlePointerMove = useCallback(() => {
    showControls();
  }, [showControls]);

  const handlePointerDown = useCallback(() => {
    showControls();
  }, [showControls]);

  const handleTouchStart = useCallback(() => {
    showControls();
  }, [showControls]);

  // --- Effects (all callbacks defined above) ---

  // Clear timers on unmount.
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
  // (e.g. Xtream providers where web playback is unsupported).
  useEffect(() => {
    if (stream && !stream.playable && playerState === 'loading') {
      setPlayerState('failed');
    }
  }, [stream, playerState]);

  // --- Startup timeout -------------------------------------------------------
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
      handleAttemptRetry();
    }, delay);

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState, retryCount]);

  // --- API support detection -------------------------------------------------
  useEffect(() => {
    setFullscreenSupported(
      typeof document.fullscreenEnabled === 'boolean' && document.fullscreenEnabled,
    );
    setPipSupported(
      typeof document.pictureInPictureEnabled === 'boolean' && document.pictureInPictureEnabled,
    );
  }, []);

  // Fullscreen change listener.
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Picture-in-Picture change listeners.
  useEffect(() => {
    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);
    document.addEventListener('enterpictureinpicture', onEnterPip);
    document.addEventListener('leavepictureinpicture', onLeavePip);
    return () => {
      document.removeEventListener('enterpictureinpicture', onEnterPip);
      document.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, []);

  // --- Keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (event.key) {
        case ' ':
        case 'Enter':
          event.preventDefault();
          handleTogglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (duration > 0 && isSeekable) {
            video.currentTime = Math.max(0, video.currentTime - SEEK_OFFSET_SECONDS);
            setCurrentTime(video.currentTime);
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (duration > 0 && isSeekable) {
            video.currentTime = Math.min(duration, video.currentTime + SEEK_OFFSET_SECONDS);
            setCurrentTime(video.currentTime);
          }
          break;
        case 'm':
        case 'M':
          handleToggleMute();
          break;
        case 'f':
        case 'F':
          handleToggleFullscreen();
          break;
        case 'Escape':
          if (isFullscreen) {
            void document.exitFullscreen?.();
          }
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [duration, isFullscreen, isSeekable, handleTogglePlay, handleToggleMute, handleToggleFullscreen]);

  // --- Autoplay on connecting ------------------------------------------------
  useEffect(() => {
    if (playerState === 'connecting') {
      void handlePlay();
    }
  }, [playerState, handlePlay]);

  // --- Render ----------------------------------------------------------------
  if (!kind) {
    return (
      <div className="inner-page phase-page">
        <div className="empty-state">
          <h1>Invalid player route</h1>
          <Link to="/" className="button button--ghost">
            Return home
          </Link>
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
          <Link to="/" className="button button--ghost">
            Return home
          </Link>
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
          <Link to="/" className="button button--ghost">
            Return home
          </Link>
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
          <Link to="/" className="button button--ghost">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  const streamUrl = resolution.streamUrl!;
  const isHls = isHlsUrl(streamUrl);

  const probe = (type: string) => {
    const video = document.createElement('video');
    return video.canPlayType(type) !== '';
  };
  const canPlay = isHls ? nativeHlsSupported || hlsJsSupported : probe('video/mp4');

  const autoRetryAvailable = retryCount < MAX_RETRIES;
  const kindLabel = kind === 'channel' ? 'Live TV' : kind === 'movie' ? 'Movie' : 'Episode';

  // --- Engine + quality menus -------------------------------------------------
  const engineMenuOptions = hasHlsStream
    ? availableEngines({ nativeHls: nativeHlsSupported, hlsJs: hlsJsSupported })
    : [];
  const selectedEnginePreference: EnginePreference = engineOverride ?? enginePreference;
  const engineMenuItems: PlayerMenuItem[] = engineMenuOptions.map((option) => ({
    key: option.value,
    label: option.label,
    active: option.value === selectedEnginePreference,
    onSelect: () => selectEngine(option.value),
  }));

  const nativeQuality = nativeQualityLabel(videoSize.height);
  const activeHlsLevel = hlsLevels.find((level) => level.index === hlsActiveLevel) ?? null;
  const qualityValue =
    engine === 'hls'
      ? hlsAuto || !activeHlsLevel
        ? 'Auto'
        : formatQualityLabel(activeHlsLevel)
      : (nativeQuality ?? 'Quality');

  const qualityMenuItems: PlayerMenuItem[] =
    engine === 'hls'
      ? describeQualityOptions(hlsLevels, hlsActiveLevel, hlsAuto).map((option) => ({
          key: option.key,
          label: option.label,
          active: option.active,
          disabled: option.disabled,
          onSelect: () => selectQuality(option.levelIndex),
        }))
      : [
          {
            key: 'native-quality',
            label: nativeQuality ?? QUALITY_UNAVAILABLE_NATIVE,
            active: true,
            disabled: true,
          },
          ...(hasHlsStream && hlsJsSupported
            ? [
                {
                  key: 'switch-to-hls',
                  label: 'Switch to HLS.js for quality control',
                  onSelect: () => selectEngine('hls'),
                },
              ]
            : []),
        ];

  return (
    <div
      className="player-page"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onTouchStart={handleTouchStart}
      tabIndex={-1}
    >
      <div className="player-frame">
        <Link to="/" className="button button--quiet" aria-label="Exit player">
          <ArrowLeft size={18} /> Exit player
        </Link>

        {controlsVisible && (
          <div className="player-controls-top">
            <span className="player-eyebrow">{kindLabel}</span>
            {isLive && (
              <span className="badge badge--live">
                <span className="badge__pulse" aria-hidden="true" />
                LIVE
              </span>
            )}
            <div className="player-menu-group">
              {engineMenuItems.length > 1 && (
                <PlayerMenu
                  label="Playback engine"
                  value={engine === 'hls' ? 'HLS.js' : 'Native'}
                  items={engineMenuItems}
                  icon={<SlidersHorizontal size={14} aria-hidden="true" />}
                  testId="player-engine-menu"
                />
              )}
              <PlayerMenu
                label="Quality"
                value={qualityValue}
                items={qualityMenuItems}
                icon={<Gauge size={14} aria-hidden="true" />}
                testId="player-quality-menu"
              />
            </div>
          </div>
        )}

        {canPlay ? (
          <div className="player-video-container">
            <video
              ref={attachVideoElement}
              autoPlay
              playsInline
              muted={isMuted}
              onError={handleVideoError}
              onWaiting={handleVideoWaiting}
              onPlaying={handleVideoPlaying}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onTimeUpdate={handleVideoTimeUpdate}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onClick={handleTogglePlay}
              className="player-video"
              data-testid="player-video"
              data-engine={engine}
            >
              {engine === 'native' && (
                <source key={`${streamUrl}-${attachNonce}`} src={streamUrl} />
              )}
            </video>

            {engineNotice && (
              <p className="player-engine-notice" role="status">
                {engineNotice}
              </p>
            )}

            {playerState === 'buffering' && (
              <div className="player-buffering">
                <AlertCircle size={24} />
                <p>Buffering…</p>
              </div>
            )}

            {!playError && controlsVisible && (
              <div className="player-controls-bottom">
                <div className="player-controls-row">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={handleTogglePlay}
                    aria-label={isPaused ? 'Play' : 'Pause'}
                    data-testid="player-btn-play"
                  >
                    {isPaused ? <Play size={20} /> : <Pause size={20} />}
                  </button>

                  {isSeekable && duration > 0 && (
                    <div className="player-progress">
                      <span className="player-time">{formatTime(currentTime)}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={duration > 0 ? (currentTime / duration) * 100 : 0}
                        onChange={(event) => handleSeek(Number(event.target.value))}
                        className="player-progress-input"
                        data-testid="player-progress"
                        disabled={!isSeekable}
                      />
                      <span className="player-time">{formatTime(duration)}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="icon-button"
                    onClick={handleToggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    data-testid="player-btn-mute"
                  >
                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={isMuted ? 0 : volume}
                    onChange={(event) => handleVolumeChange(Number(event.target.value))}
                    className="player-volume-input"
                    aria-label="Volume"
                    data-testid="player-volume"
                  />

                  {pipSupported && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={handleTogglePip}
                      aria-label="Picture-in-Picture"
                      data-testid="player-btn-pip"
                    >
                      <MonitorPlay size={20} />
                    </button>
                  )}

                  {fullscreenSupported && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={handleToggleFullscreen}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      data-testid="player-btn-fullscreen"
                    >
                      {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {playError && (
              <div className="player-error">
                <p>{playError}</p>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleManualRetry}
                >
                  <RefreshCw size={18} />
                  {playError.includes('blocked') || playError.includes('Could not start')
                    ? 'Click to Play'
                    : 'Retry Playback'}
                </button>
                {engine === 'hls' && nativeHlsSupported && (
                  <button type="button" className="button button--ghost" onClick={() => selectEngine('native')}>
                    Use native player
                  </button>
                )}
                {!autoRetryAvailable && (
                  <p className="player-error__terminal">
                    Automatic retries exhausted. Try again manually when ready.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {!canPlay && !playError ? (
          <div className="player-frame__center">
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
