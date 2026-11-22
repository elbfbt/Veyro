/**
 * hls.js adapter.
 *
 * hls.js is loaded lazily with a dynamic import so it never enters the main
 * bundle; the adapter takes an injectable loader so teardown, level reporting
 * and fatal-error routing can be unit tested without a real player.
 *
 * hls.js fetches the manifest and segments with XHR/fetch, so the provider must
 * allow cross-origin requests. Native <video> playback has no such requirement,
 * which is why Auto mode falls back to native on network failures.
 */

import type { QualityLevel } from './playerEngine';

export type HlsFatalErrorKind = 'network' | 'media' | 'unavailable' | 'other';

export interface HlsFailure {
  kind: HlsFatalErrorKind;
  details: string;
}

export interface HlsLevelLike {
  height?: number;
  bitrate?: number;
  name?: string | null;
}

export interface HlsErrorDataLike {
  type?: string;
  details?: string;
  fatal?: boolean;
  response?: { code?: number };
  error?: unknown;
}

export interface HlsInstanceLike {
  attachMedia(media: HTMLMediaElement): void;
  loadSource(url: string): void;
  destroy(): void;
  on(event: string, handler: (event: unknown, data: HlsErrorDataLike & { level?: number }) => void): void;
  levels: HlsLevelLike[];
  currentLevel: number;
  autoLevelEnabled?: boolean;
}

export interface HlsStaticLike {
  new (config?: Record<string, unknown>): HlsInstanceLike;
  isSupported(): boolean;
  Events: {
    MANIFEST_PARSED: string;
    LEVELS_UPDATED: string;
    LEVEL_SWITCHED: string;
    ERROR: string;
  };
}

export interface HlsModule {
  default: HlsStaticLike;
}

export type HlsLoader = () => Promise<HlsModule>;

/** Real loader: a separate chunk, fetched on first HLS playback. */
export const loadHlsJs: HlsLoader = () => import('hls.js') as unknown as Promise<HlsModule>;

export function classifyHlsError(data: HlsErrorDataLike | null | undefined): HlsFatalErrorKind {
  if (!data) return 'other';
  if (data.type === 'networkError') return 'network';
  if (data.type === 'mediaError') return 'media';
  return 'other';
}

/**
 * Tear down the media element: stop playback, drop the src attribute, then
 * reset the pipeline. Called before attaching a different engine so the old
 * one cannot keep playing or buffering.
 *
 * <source> children are intentionally left alone: they are owned by React and
 * removing them imperatively would desync the next render.
 */
export function resetMediaElement(media: HTMLMediaElement): void {
  try {
    media.pause();
  } catch {
    // Autoplay policies can make pause() throw; the reset below still matters.
  }
  media.removeAttribute('src');
  try {
    media.load();
  } catch {
    // load() is a no-op on elements without a document in tests.
  }
}

export interface AttachHlsOptions {
  video: HTMLVideoElement;
  url: string;
  loader?: HlsLoader;
  /** Starting level: -1 for auto, otherwise a level index. */
  startLevel?: number;
  /** Resume position (seconds) restored for VOD; live streams reconnect instead. */
  restoreTime?: number | null;
  onLevels?: (levels: QualityLevel[]) => void;
  onLevelSwitch?: (info: { level: number; auto: boolean }) => void;
  onFatalError?: (failure: HlsFailure) => void;
  onReady?: () => void;
}

export interface HlsEngineHandle {
  setLevel(index: number): void;
  destroy(): void;
  readonly levels: QualityLevel[];
  readonly instance: HlsInstanceLike;
}

export async function attachHlsEngine(options: AttachHlsOptions): Promise<HlsEngineHandle | null> {
  const loader = options.loader ?? loadHlsJs;

  let module: HlsModule;
  try {
    module = await loader();
  } catch {
    options.onFatalError?.({ kind: 'unavailable', details: 'hls.js could not be loaded' });
    return null;
  }

  const HlsCtor = module.default;
  if (!HlsCtor || typeof HlsCtor.isSupported !== 'function' || !HlsCtor.isSupported()) {
    options.onFatalError?.({ kind: 'unavailable', details: 'hls.js is not supported in this browser' });
    return null;
  }

  let destroyed = false;
  const instance = new HlsCtor({ enableWorker: true, lowLatencyMode: false });
  let levels: QualityLevel[] = [];

  const publishLevels = () => {
    if (destroyed) return;
    levels = (instance.levels ?? []).map((level, index) => ({
      index,
      height: typeof level.height === 'number' ? level.height : null,
      bitrate: typeof level.bitrate === 'number' ? level.bitrate : null,
      name: level.name ?? null,
    }));
    options.onLevels?.(levels);
  };

  instance.on(HlsCtor.Events.MANIFEST_PARSED, () => {
    if (destroyed) return;
    publishLevels();
    const restore = options.restoreTime;
    if (typeof restore === 'number' && Number.isFinite(restore) && restore > 0) {
      try {
        options.video.currentTime = restore;
      } catch {
        // Seeking before metadata is ready is not fatal; playback starts at 0.
      }
    }
    options.onReady?.();
  });

  instance.on(HlsCtor.Events.LEVELS_UPDATED, () => publishLevels());

  instance.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
    if (destroyed) return;
    const level = typeof data?.level === 'number' ? data.level : instance.currentLevel;
    options.onLevelSwitch?.({ level, auto: instance.autoLevelEnabled ?? true });
  });

  instance.on(HlsCtor.Events.ERROR, (_event, data) => {
    if (destroyed || !data?.fatal) return;
    options.onFatalError?.({ kind: classifyHlsError(data), details: String(data.details ?? '') });
  });

  instance.attachMedia(options.video);
  instance.loadSource(options.url);
  if (typeof options.startLevel === 'number' && options.startLevel !== -1) {
    instance.currentLevel = options.startLevel;
  }

  return {
    get levels() {
      return levels;
    },
    get instance() {
      return instance;
    },
    setLevel(index: number) {
      if (!destroyed) instance.currentLevel = index;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        instance.destroy();
      } catch {
        // Destroying an already-failed instance must never break the UI.
      }
    },
  };
}
