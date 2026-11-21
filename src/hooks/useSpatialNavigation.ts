import { useEffect } from 'react';
import { findSpatialTarget, type Direction, type FocusRect } from '../lib/spatial';

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
  );
}

/** Enables arrow-key/D-pad movement between elements marked `data-spatial`. */
export function useSpatialNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-spatial]')).filter(
        (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && !node.hasAttribute('disabled');
        },
      );
      if (nodes.length === 0) return;

      const activeRect = active && nodes.includes(active) ? active.getBoundingClientRect() : null;
      let targetId: string | null;

      if (activeRect) {
        const current: FocusRect = {
          id: active!.dataset.spatial ?? '',
          left: activeRect.left,
          top: activeRect.top,
          right: activeRect.right,
          bottom: activeRect.bottom,
        };
        targetId = findSpatialTarget(
          current,
          nodes.map((node, index) => {
            const rect = node.getBoundingClientRect();
            return {
              id: node.dataset.spatial || `node-${index}`,
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            };
          }),
          direction,
        );
      } else {
        // With nothing focused, arrows enter the first control in the direction.
        const first = nodes.find((node) => {
          const rect = node.getBoundingClientRect();
          return direction === 'right' ? rect.left > 0 : direction === 'down' ? rect.top > 0 : true;
        });
        targetId = first?.dataset.spatial ?? null;
      }

      if (targetId) {
        const target = nodes.find((node) => node.dataset.spatial === targetId);
        if (target) {
          event.preventDefault();
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
