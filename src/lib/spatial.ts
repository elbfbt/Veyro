/** Pure geometry helper for D-pad style focus movement. */
export interface FocusRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Chooses the best rectangular target in a direction. Candidates must be
 * meaningfully aligned on the perpendicular axis; distance is the tie-breaker.
 */
export function findSpatialTarget(
  current: FocusRect,
  candidates: FocusRect[],
  direction: Direction,
): string | null {
  const currentCenterX = (current.left + current.right) / 2;
  const currentCenterY = (current.top + current.bottom) / 2;
  const tolerance = 24;

  const scored = candidates.flatMap((candidate) => {
    if (candidate.id === current.id) return [];
    const centerX = (candidate.left + candidate.right) / 2;
    const centerY = (candidate.top + candidate.bottom) / 2;

    let distance = 0;
    let perpendicularOffset = 0;

    if (direction === 'right') {
      if (centerX <= currentCenterX) return [];
      distance = candidate.left - current.right;
      perpendicularOffset = Math.abs(centerY - currentCenterY);
    } else if (direction === 'left') {
      if (centerX >= currentCenterX) return [];
      distance = current.left - candidate.right;
      perpendicularOffset = Math.abs(centerY - currentCenterY);
    } else if (direction === 'down') {
      if (centerY <= currentCenterY) return [];
      distance = candidate.top - current.bottom;
      perpendicularOffset = Math.abs(centerX - currentCenterX);
    } else {
      if (centerY >= currentCenterY) return [];
      distance = current.top - candidate.bottom;
      perpendicularOffset = Math.abs(centerX - currentCenterX);
    }

    if (distance < 0) distance = 0;
    if (perpendicularOffset > Math.max(tolerance, (candidate.right - candidate.left) / 2)) {
      return [];
    }
    return [{ id: candidate.id, score: distance + perpendicularOffset * 2 }];
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.id ?? null;
}
