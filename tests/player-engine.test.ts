import { describe, expect, it, vi } from 'vitest';
import {
  availableEngines,
  describeQualityOptions,
  formatQualityLabel,
  hasQualityChoices,
  isHlsUrl,
  nativeQualityLabel,
  normalizeEnginePreference,
  QUALITY_UNAVAILABLE_NATIVE,
  resolveEngine,
  shouldFallbackToNative,
  type QualityLevel,
} from '../src/lib/playerEngine';
import {
  attachHlsEngine,
  classifyHlsError,
  resetMediaElement,
  type HlsErrorDataLike,
  type HlsInstanceLike,
  type HlsModule,
  type HlsStaticLike,
} from '../src/lib/hlsEngine';

describe('isHlsUrl', () => {
  it('recognises HLS manifests with query strings and fragments', () => {
    expect(isHlsUrl('https://stream.test/live.m3u8')).toBe(true);
    expect(isHlsUrl('https://stream.test/live.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('https://stream.test/live.m3u8#t=10')).toBe(true);
    expect(isHlsUrl('https://stream.test/movie.mp4')).toBe(false);
    expect(isHlsUrl('https://stream.test/m3u8')).toBe(false);
  });
});

describe('resolveEngine', () => {
  it('keeps native playback as the Auto default when the browser supports HLS', () => {
    expect(resolveEngine('auto', { nativeHls: true, hlsJs: true })).toBe('native');
    expect(resolveEngine('auto', { nativeHls: true, hlsJs: false })).toBe('native');
  });

  it('uses hls.js in Auto only when native HLS is unavailable', () => {
    expect(resolveEngine('auto', { nativeHls: false, hlsJs: true })).toBe('hls');
    expect(resolveEngine('auto', { nativeHls: false, hlsJs: false })).toBe('native');
  });

  it('honours an explicit choice and degrades safely when it cannot run', () => {
    expect(resolveEngine('hls', { nativeHls: false, hlsJs: true })).toBe('hls');
    expect(resolveEngine('hls', { nativeHls: true, hlsJs: false })).toBe('native');
    expect(resolveEngine('native', { nativeHls: false, hlsJs: true })).toBe('native');
  });
});

describe('availableEngines', () => {
  it('never offers an engine that is not implemented', () => {
    const values = availableEngines({ nativeHls: true, hlsJs: true }).map((option) => option.value);
    expect(values).toEqual(['auto', 'native', 'hls']);
    expect(values).not.toContain('shaka');
  });

  it('hides the selector when only one engine can work', () => {
    expect(availableEngines({ nativeHls: true, hlsJs: false })).toHaveLength(1);
    expect(availableEngines({ nativeHls: false, hlsJs: true })).toHaveLength(1);
    expect(availableEngines({ nativeHls: false, hlsJs: false })).toHaveLength(1);
  });
});

describe('engine preference normalisation', () => {
  it('maps the retired shaka value and garbage to auto', () => {
    expect(normalizeEnginePreference('shaka')).toBe('auto');
    expect(normalizeEnginePreference(undefined)).toBe('auto');
    expect(normalizeEnginePreference('hls')).toBe('hls');
    expect(normalizeEnginePreference('native')).toBe('native');
  });
});

describe('CORS / network fallback policy', () => {
  it('falls back to native for network failures in Auto mode', () => {
    expect(shouldFallbackToNative('auto', 'network', { nativeHls: false, hlsJs: true })).toBe(true);
    expect(shouldFallbackToNative('auto', 'media', { nativeHls: false, hlsJs: true })).toBe(true);
  });

  it('only falls back when hls.js itself is unavailable if native can play HLS', () => {
    expect(shouldFallbackToNative('auto', 'unavailable', { nativeHls: true, hlsJs: true })).toBe(true);
    expect(shouldFallbackToNative('auto', 'unavailable', { nativeHls: false, hlsJs: true })).toBe(false);
  });

  it('never overrides an explicit engine choice', () => {
    expect(shouldFallbackToNative('hls', 'network', { nativeHls: true, hlsJs: true })).toBe(false);
    expect(shouldFallbackToNative('native', 'network', { nativeHls: true, hlsJs: true })).toBe(false);
  });
});

describe('quality labels', () => {
  const levels: QualityLevel[] = [
    { index: 0, height: 1080, bitrate: 5_000_000 },
    { index: 1, height: 720, bitrate: 2_500_000 },
    { index: 2, height: null, bitrate: 800_000 },
  ];

  it('labels levels from their height and bitrate', () => {
    expect(formatQualityLabel(levels[0]!)).toBe('1080p · 5.0 Mbps');
    expect(formatQualityLabel(levels[1]!)).toBe('720p · 2.5 Mbps');
    expect(formatQualityLabel(levels[2]!)).toBe('Level 3 · 0.8 Mbps');
    expect(formatQualityLabel({ index: 0, height: 480, bitrate: null })).toBe('480p');
    expect(formatQualityLabel({ index: 1, height: 0, bitrate: null, name: 'HD' })).toBe('HD');
  });

  it('shows the active level while Auto is selected', () => {
    const options = describeQualityOptions(levels, 1, true);
    expect(options[0]).toMatchObject({ key: 'auto', label: 'Auto (720p · 2.5 Mbps)', active: true });
    expect(options.filter((option) => option.active)).toHaveLength(1);
    expect(options.slice(1).map((option) => option.active)).toEqual([false, false, false]);
  });

  it('marks the chosen level when Auto is off', () => {
    const options = describeQualityOptions(levels, 0, false);
    expect(options[0]).toMatchObject({ key: 'auto', label: 'Auto', active: false });
    expect(options[1]).toMatchObject({ key: 'level-0', active: true });
  });

  it('offers no choices for a single rendition', () => {
    const single: QualityLevel[] = [{ index: 0, height: 1080, bitrate: 4_000_000 }];
    expect(describeQualityOptions(single, 0, true)).toEqual([
      { key: 'level-0', label: '1080p · 4.0 Mbps', levelIndex: 0, active: true, disabled: true },
    ]);
    expect(hasQualityChoices(single)).toBe(false);
    expect(hasQualityChoices(levels)).toBe(true);
  });

  it('explains that levels are not known yet', () => {
    expect(describeQualityOptions([], -1, true)).toEqual([
      { key: 'detecting', label: 'Detecting quality…', levelIndex: -1, active: false, disabled: true },
    ]);
  });

  it('reports the native resolution, or nothing when unknown', () => {
    expect(nativeQualityLabel(1080)).toBe('1080p');
    expect(nativeQualityLabel(0)).toBeNull();
    expect(nativeQualityLabel(undefined)).toBeNull();
    expect(QUALITY_UNAVAILABLE_NATIVE).toBe('Adaptive quality unavailable with this engine');
  });
});

/** Minimal fake of the hls.js API surface used by the adapter. */
function createFakeHls(options: { supported?: boolean } = {}) {
  const handlers = new EventTarget();
  const instance = {
    attachMedia: vi.fn(),
    loadSource: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, handler: (e: unknown, data: unknown) => void) => {
      handlers.addEventListener(event, (payload) => handler({}, (payload as CustomEvent).detail));
    }),
    levels: [
      { height: 1080, bitrate: 5_000_000 },
      { height: 720, bitrate: 2_500_000 },
    ],
    currentLevel: -1,
    autoLevelEnabled: true as boolean,
  } satisfies HlsInstanceLike;

  const emit = (event: string, data: unknown) => {
    handlers.dispatchEvent(new CustomEvent(event, { detail: data }));
  };

  const HlsCtor = function HlsConstructor() {
    return instance;
  } as unknown as HlsStaticLike;

  (HlsCtor as unknown as { isSupported: () => boolean }).isSupported = () =>
    options.supported ?? true;
  Object.assign(HlsCtor, {
    Events: {
      MANIFEST_PARSED: 'manifestParsed',
      LEVELS_UPDATED: 'levelsUpdated',
      LEVEL_SWITCHED: 'levelSwitched',
      ERROR: 'error',
    },
  });

  const module: HlsModule = { default: HlsCtor };
  return { module, instance, emit };
}

function createVideo() {
  const listeners = new Map<string, () => void>();
  const video = {
    currentTime: 0,
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    querySelectorAll: vi.fn(() => [] as Element[]),
    addEventListener: vi.fn((type: string, handler: () => void) => {
      listeners.set(type, handler);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
  };
  return { video, listeners };
}

describe('attachHlsEngine', () => {
  it('attaches the media element, loads the source and publishes levels', async () => {
    const fake = createFakeHls();
    const { video } = createVideo();
    const onLevels = vi.fn();
    const onReady = vi.fn();

    const handle = await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/live.m3u8',
      loader: async () => fake.module,
      onLevels,
      onReady,
    });

    expect(fake.instance.attachMedia).toHaveBeenCalledWith(video);
    expect(fake.instance.loadSource).toHaveBeenCalledWith('https://stream.test/live.m3u8');

    fake.emit('manifestParsed', {});
    expect(onReady).toHaveBeenCalled();
    expect(onLevels).toHaveBeenCalledWith([
      { index: 0, height: 1080, bitrate: 5_000_000, name: null },
      { index: 1, height: 720, bitrate: 2_500_000, name: null },
    ]);
    expect(handle?.levels.map((level) => level.height)).toEqual([1080, 720]);
  });

  it('switches quality through currentLevel and reports level changes', async () => {
    const fake = createFakeHls();
    const { video } = createVideo();
    const onLevelSwitch = vi.fn();

    const handle = await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/live.m3u8',
      loader: async () => fake.module,
      onLevelSwitch,
    });

    handle?.setLevel(1);
    expect(fake.instance.currentLevel).toBe(1);

    handle?.setLevel(-1);
    expect(fake.instance.currentLevel).toBe(-1);

    fake.instance.autoLevelEnabled = false;
    fake.emit('levelSwitched', { level: 1 });
    expect(onLevelSwitch).toHaveBeenCalledWith({ level: 1, auto: false });
  });

  it('routes fatal errors only, and destroys exactly once', async () => {
    const fake = createFakeHls();
    const { video } = createVideo();
    const onFatalError = vi.fn();

    const handle = await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/live.m3u8',
      loader: async () => fake.module,
      onFatalError,
    });

    fake.emit('error', { fatal: false, type: 'networkError', details: 'fragParsingError' });
    expect(onFatalError).not.toHaveBeenCalled();

    fake.emit('error', { fatal: true, type: 'networkError', details: 'manifestLoadError' });
    expect(onFatalError).toHaveBeenCalledWith({ kind: 'network', details: 'manifestLoadError' });

    handle?.destroy();
    handle?.destroy();
    expect(fake.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('restores the previous position for VOD once the manifest is parsed', async () => {
    const fake = createFakeHls();
    const { video } = createVideo();
    video.currentTime = 0;

    await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/movie.m3u8',
      loader: async () => fake.module,
      restoreTime: 432,
    });

    fake.emit('manifestParsed', {});
    expect(video.currentTime).toBe(432);
  });

  it('reports an unavailable engine when hls.js cannot be loaded', async () => {
    const { video } = createVideo();
    const onFatalError = vi.fn();

    const handle = await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/live.m3u8',
      loader: async () => {
        throw new Error('chunk blocked');
      },
      onFatalError,
    });

    expect(handle).toBeNull();
    expect(onFatalError).toHaveBeenCalledWith({ kind: 'unavailable', details: 'hls.js could not be loaded' });
  });

  it('reports an unavailable engine when the browser has no MediaSource', async () => {
    const fake = createFakeHls({ supported: false });
    const { video } = createVideo();
    const onFatalError = vi.fn();

    const handle = await attachHlsEngine({
      video: video as unknown as HTMLVideoElement,
      url: 'https://stream.test/live.m3u8',
      loader: async () => fake.module,
      onFatalError,
    });

    expect(handle).toBeNull();
    expect(onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'unavailable' }),
    );
  });
});

describe('engine switch teardown', () => {
  it('pauses, removes the src attribute, then reloads', () => {
    const order: string[] = [];
    const video = {
      pause: () => order.push('pause'),
      removeAttribute: (name: string) => order.push(`remove-${name}`),
      load: () => order.push('load'),
    };

    resetMediaElement(video as unknown as HTMLMediaElement);

    expect(order).toEqual(['pause', 'remove-src', 'load']);
  });

  it('leaves React-owned <source> children alone', () => {
    const removed: string[] = [];
    const video = {
      pause: () => undefined,
      removeAttribute: () => undefined,
      querySelectorAll: () => [{ remove: () => removed.push('source') }],
      load: () => undefined,
    };

    resetMediaElement(video as unknown as HTMLMediaElement);
    expect(removed).toEqual([]);
  });

  it('survives elements that throw while resetting', () => {
    const video = {
      pause: () => {
        throw new Error('blocked');
      },
      removeAttribute: () => undefined,
      querySelectorAll: () => [],
      load: () => {
        throw new Error('no document');
      },
    };
    expect(() => resetMediaElement(video as unknown as HTMLMediaElement)).not.toThrow();
  });
});

describe('classifyHlsError', () => {
  it('maps hls.js error types to engine failure kinds', () => {
    const cases: [HlsErrorDataLike, string][] = [
      [{ type: 'networkError', details: 'manifestLoadError' }, 'network'],
      [{ type: 'mediaError', details: 'bufferAppendError' }, 'media'],
      [{ type: 'otherError' }, 'other'],
      [{}, 'other'],
    ];
    for (const [data, expected] of cases) {
      expect(classifyHlsError(data)).toBe(expected);
    }
    expect(classifyHlsError(null)).toBe('other');
  });
});
