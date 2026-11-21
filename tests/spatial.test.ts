import { describe, expect, it } from 'vitest';
import { findSpatialTarget, type FocusRect } from '../src/lib/spatial';

const rect = (id: string, left: number, top: number, width = 100, height = 50): FocusRect => ({
  id,
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('D-pad spatial navigation', () => {
  const current = rect('current', 0, 0);

  it('moves right to the nearest aligned target', () => {
    const candidates = [rect('near', 150, 0), rect('far', 400, 0), rect('above', 150, -100)];
    expect(findSpatialTarget(current, candidates, 'right')).toBe('near');
  });

  it('moves down and ignores poorly aligned targets', () => {
    const candidates = [rect('below', 0, 100), rect('misaligned', 600, 110)];
    expect(findSpatialTarget(current, candidates, 'down')).toBe('below');
  });

  it('returns null when no target exists in the direction', () => {
    expect(findSpatialTarget(current, [rect('left', -200, 0)], 'right')).toBeNull();
  });
});
