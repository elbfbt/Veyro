import { describe, expect, it } from 'vitest';
import { shouldDismissSwipe, swipeOffset } from '../src/lib/gestures';

describe('swipe-to-dismiss geometry', () => {
  it('follows a leftward drag and ignores rightward movement', () => {
    expect(swipeOffset({ dx: -80, dy: 4, width: 300 })).toBe(-80);
    expect(swipeOffset({ dx: 40, dy: 0, width: 300 })).toBe(0);
  });

  it('never travels further than the drawer width', () => {
    expect(swipeOffset({ dx: -500, dy: 0, width: 300 })).toBe(-300);
  });

  it('ignores mostly vertical gestures so scrolling still works', () => {
    expect(swipeOffset({ dx: -60, dy: 90, width: 300 })).toBe(0);
    expect(shouldDismissSwipe({ dx: -200, dy: 300, width: 300 })).toBe(false);
  });

  it('dismisses only past 30% of the drawer width or 64px', () => {
    expect(shouldDismissSwipe({ dx: -40, dy: 0, width: 200 })).toBe(false);
    expect(shouldDismissSwipe({ dx: -70, dy: 0, width: 200 })).toBe(true);
    expect(shouldDismissSwipe({ dx: -100, dy: 0, width: 600 })).toBe(false);
    expect(shouldDismissSwipe({ dx: -190, dy: 0, width: 600 })).toBe(true);
  });
});
