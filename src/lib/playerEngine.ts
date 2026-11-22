/**
 * Pure playback-engine and quality helpers.
 *
 * Kept free of React/DOM so the engine selection, CORS fallback policy and
 * quality labels can be unit tested without a browser.
 *
 * Engines that are actually implemented in this app:
 *   - native: the browser's own <video> pipeline (HLS on Safari/iOS, MP4 everywhere)
 *   - hls:    hls.js, lazily imported, HLS only
 * Shaka is NOT implemented and is never offered as an option.
 */

export type PlaybackEngine = 'native' | 'hls';

export type EnginePreference = 'auto' | 'native' | 'hls';

export interface EngineCapabilities {
  /** The browser can play HLS natively (Safari, iOS, some smart TVs). */
  nativeHls: boolean;
  /** hls.js can run here (MediaSource available) and can be lazily imported. */
  hlsJs: boolean;
}

export interface EngineOption {
  value: EnginePreference;
  label: string;
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8([?#]|$)/i.test(url);
}

/** Coerce a stored preference (including the retired `shaka` value) to a real engine. */
export function normalizeEnginePreference(value: string | null | undefined): EnginePreference {
  return value === 'native' || value === 'hls' ? value : 'auto';
}

/**
 * Resolve the engine to use. Auto prefers the native pipeline when the browser
 * supports it, because native playback needs no CORS approval from the
 * provider; hls.js is only used when native HLS is unavailable.
 */
export function resolveEngine(
  preference: EnginePreference,
  capabilities: EngineCapabilities,
): PlaybackEngine {
  if (preference === 'native') return 'native';
  if (preference === 'hls') return capabilities.hlsJs ? 'hls' : 'native';
  if (capabilities.nativeHls) return 'native';
  return capabilities.hlsJs ? 'hls' : 'native';
}

/**
 * Engines that can really play this URL. Only options that work are returned,
 * and the selector is hidden when there is nothing to choose.
 */
export function availableEngines(capabilities: EngineCapabilities): EngineOption[] {
  const options: EngineOption[] = [];
  if (capabilities.nativeHls) options.push({ value: 'native', label: 'Native HTML5' });
  if (capabilities.hlsJs) options.push({ value: 'hls', label: 'HLS.js' });
  if (options.length === 0) options.push({ value: 'native', label: 'Native HTML5' });
  if (options.length > 1) options.unshift({ value: 'auto', label: 'Auto' });
  return options;
}

export type EngineFailureKind = 'network' | 'media' | 'unavailable' | 'other';

/**
 * Auto mode recovers from an hls.js failure by retrying with the native
 * pipeline, because native playback does not need the provider to allow
 * cross-origin requests and `canPlayType()` is only a heuristic. An explicit
 * engine choice is never overridden behind the user's back.
 *
 * hls.js being unavailable (chunk blocked, no MediaSource) can only be
 * recovered when the browser actually plays HLS natively.
 */
export function shouldFallbackToNative(
  preference: EnginePreference,
  kind: EngineFailureKind,
  capabilities: EngineCapabilities,
): boolean {
  if (preference !== 'auto') return false;
  if (kind === 'unavailable') return capabilities.nativeHls;
  return true;
}

export interface QualityLevel {
  index: number;
  height: number | null;
  bitrate: number | null;
  name?: string | null;
}

/** Human label for an hls.js level, e.g. "1080p" or "720p · 2.5 Mbps". */
export function formatQualityLabel(level: QualityLevel): string {
  const height = level.height && level.height > 0 ? Math.round(level.height) : null;
  const bitrate =
    level.bitrate && level.bitrate > 0 ? `${(level.bitrate / 1_000_000).toFixed(1)} Mbps` : null;
  const trimmedName = typeof level.name === 'string' ? level.name.trim() : '';
  const base = height ? `${height}p` : trimmedName || `Level ${level.index + 1}`;
  return bitrate ? `${base} · ${bitrate}` : base;
}

export interface QualityOption {
  key: string;
  label: string;
  /** -1 for auto; otherwise the hls.js level index. */
  levelIndex: number;
  active: boolean;
  disabled: boolean;
}

/**
 * Menu entries for the manual quality selector. Auto shows the level that is
 * currently playing so the user can see what the adaptive algorithm picked.
 */
export function describeQualityOptions(
  levels: QualityLevel[],
  activeLevel: number,
  auto: boolean,
): QualityOption[] {
  if (levels.length === 0) {
    return [{ key: 'detecting', label: 'Detecting quality…', levelIndex: -1, active: false, disabled: true }];
  }

  if (levels.length === 1) {
    const only = levels[0] as QualityLevel;
    return [
      {
        key: `level-${only.index}`,
        label: formatQualityLabel(only),
        levelIndex: only.index,
        active: true,
        disabled: true,
      },
    ];
  }

  const active = levels.find((level) => level.index === activeLevel);
  const autoLabel = auto && active ? `Auto (${formatQualityLabel(active)})` : 'Auto';
  const options: QualityOption[] = [
    { key: 'auto', label: autoLabel, levelIndex: -1, active: auto, disabled: false },
  ];

  for (const level of levels) {
    options.push({
      key: `level-${level.index}`,
      label: formatQualityLabel(level),
      levelIndex: level.index,
      active: !auto && level.index === activeLevel,
      disabled: false,
    });
  }
  return options;
}

/** True when the playlist exposes more than one rendition worth choosing. */
export function hasQualityChoices(levels: QualityLevel[]): boolean {
  return levels.length > 1;
}

/** Current resolution reported by a native <video> element, if known. */
export function nativeQualityLabel(height: number | null | undefined): string | null {
  if (!height || height <= 0) return null;
  return `${Math.round(height)}p`;
}

export const QUALITY_UNAVAILABLE_NATIVE =
  'Adaptive quality unavailable with this engine';
