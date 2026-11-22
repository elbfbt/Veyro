import { flushSync } from 'react-dom';

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export function supportsViewTransition(doc: Document = document): boolean {
  return typeof (doc as DocumentWithVT).startViewTransition === 'function';
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Runs a navigation inside a View Transition when the browser supports it and
 * motion is allowed. Returns false when the update ran without a transition.
 */
export function runViewTransition(update: () => void): boolean {
  const doc = document as DocumentWithVT;
  if (!supportsViewTransition(doc) || prefersReducedMotion()) {
    update();
    return false;
  }
  doc.startViewTransition?.(() => {
    flushSync(update);
  });
  return true;
}

/** CSS custom-ident-safe shared-element name for a catalogue item's artwork. */
export function artworkTransitionName(id: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `artwork-${safe || 'item'}`;
}
