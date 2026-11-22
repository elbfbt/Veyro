import { useEffect, useRef, useState, type RefObject } from 'react';
import { shouldDismissSwipe, swipeOffset } from '../lib/gestures';

interface Options {
  ref: RefObject<HTMLElement>;
  enabled: boolean;
  onDismiss: () => void;
}

/**
 * Pointer-driven swipe-to-dismiss for the mobile navigation drawer. Only
 * horizontal movement is captured, so vertical scrolling still works.
 */
export function useSwipeToDismiss({ ref, enabled, onDismiss }: Options) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; y: number; width: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      origin.current = {
        x: event.clientX,
        y: event.clientY,
        width: element.getBoundingClientRect().width,
      };
      setDragging(true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.abs(dy) > Math.abs(dx) && !event.buttons) {
        origin.current = null;
        setDragging(false);
        setOffset(0);
        return;
      }
      setOffset(swipeOffset({ dx, dy, width: origin.current.width }));
    };

    const finish = (event: PointerEvent) => {
      if (!origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      const width = origin.current.width;
      origin.current = null;
      setDragging(false);
      setOffset(0);
      if (shouldDismissSwipe({ dx, dy, width })) onDismiss();
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
    };
  }, [enabled, onDismiss, ref]);

  return { offset, dragging };
}
