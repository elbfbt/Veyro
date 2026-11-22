/** Geometry for swipe-to-dismiss drawers, kept pure for testing. */

export interface SwipeInput {
  dx: number;
  dy: number;
  width: number;
}

/** Distance the drawer travels for a horizontal drag, clamped to its width. */
export function swipeOffset({ dx, dy, width }: SwipeInput): number {
  if (dx >= 0 || Math.abs(dy) > Math.abs(dx) * 1.2) return 0;
  return Math.max(-width, dx);
}

/**
 * Dismiss when the drawer has been dragged past 30% of its width (or 64px),
 * and the gesture was clearly horizontal rather than a vertical scroll.
 */
export function shouldDismissSwipe({ dx, dy, width }: SwipeInput): boolean {
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return false;
  return dx < -Math.max(64, width * 0.3);
}
