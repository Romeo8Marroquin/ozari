import { useSyncExternalStore } from 'react';

/**
 * Tracks whether the user has made a genuine input gesture (`pointerdown`/`keydown`/
 * `touchstart`) since the page loaded. These events are produced ONLY by real user input —
 * never by programmatic focus/blur (those fire trusted `focus`/`blur` events, so `isTrusted`
 * alone can't distinguish them) and never by our synthetic events. A full reload resets it.
 *
 * Two uses:
 *  - gating field-error DISPLAY, so a password manager shuffling focus after our autofocus
 *    can't flash a "required" error before the user has touched anything (reactive hook), and
 *  - gating autofill auto-submit, so a page-load autofill never submits (imperative getter).
 *
 * Backed by a single module-level listener set shared across all callers.
 */
let hasGestured = false;
const subscribers = new Set<() => void>();
let installed = false;

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const mark = (event: Event) => {
    if (!event.isTrusted || hasGestured) return;
    hasGestured = true;
    subscribers.forEach((notify) => notify());
  };
  const options = { capture: true, passive: true } as const;
  (['pointerdown', 'keydown', 'touchstart'] as const).forEach((type) =>
    document.addEventListener(type, mark, options),
  );
}

/** Imperative read — always current (use in event handlers). */
export function hasUserGestured(): boolean {
  install();
  return hasGestured;
}

/** Reactive — re-renders once when the first trusted gesture happens. */
export default function useUserGesture(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      install();
      subscribers.add(onStoreChange);
      return () => subscribers.delete(onStoreChange);
    },
    () => hasGestured,
    () => false,
  );
}
