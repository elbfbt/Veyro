// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artworkTransitionName,
  runViewTransition,
  supportsViewTransition,
} from '../src/lib/viewTransition';

type DocumentWithVT = { startViewTransition?: (callback: () => void) => { finished: Promise<void> } };

const doc = document as unknown as DocumentWithVT;

afterEach(() => {
  doc.startViewTransition = undefined;
  vi.restoreAllMocks();
});

describe('view transitions', () => {
  it('reports support only when the browser exposes startViewTransition', () => {
    expect(supportsViewTransition()).toBe(false);
    doc.startViewTransition = vi.fn() as unknown as DocumentWithVT['startViewTransition'];
    expect(supportsViewTransition()).toBe(true);
  });

  it('still runs the update when transitions are unavailable', () => {
    const update = vi.fn();
    expect(runViewTransition(update)).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('wraps the update in startViewTransition when supported', () => {
    const update = vi.fn();
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = start as unknown as DocumentWithVT['startViewTransition'];

    expect(runViewTransition(update)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('produces css-safe shared-element names', () => {
    expect(artworkTransitionName('provider:123/movie 45')).toBe('artwork-provider-123-movie-45');
    expect(artworkTransitionName('///')).toBe('artwork-item');
  });
});
