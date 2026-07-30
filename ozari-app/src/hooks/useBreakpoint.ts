import { useSyncExternalStore } from 'react';

const tailwindBreakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

/** Largest-first, so the first match wins. */
const NAMED = Object.entries(tailwindBreakpoints)
  .sort(([, a], [, b]) => b - a) as Array<[string, number]>;

export interface BreakpointSnapshot {
  /** The active Tailwind breakpoint name, or `base` below `sm`. `null` until first measured. */
  breakpoint: string | null;
  /** True below `sm`. `undefined` until first measured (treat as "assume compact"). */
  isMobile: boolean | undefined;
}

/**
 * ONE shared subscription for the whole app (module scope, not per component).
 *
 * This used to be per-instance state with a per-instance `resize` listener, which is fine for a
 * page that reads the breakpoint once — and quietly terrible for a LIST: the agenda renders a
 * ticket (and a skeleton) per row, so 20 rows meant 20 resize listeners, each re-running up to five
 * `matchMedia` calls on every pixel of a window drag and setting two states. That is the agenda's
 * jank (the products grid never felt it — no component there reads the breakpoint).
 *
 * Now: one set of `MediaQueryList`s, one `change` listener each — which fire only when a boundary is
 * actually CROSSED, not continuously while resizing — and every consumer reads the same cached
 * snapshot. N rows cost the same as one.
 */
const listeners = new Set<() => void>();
let queries: MediaQueryList[] | null = null;
let cached: BreakpointSnapshot = { breakpoint: null, isMobile: undefined };

const measure = (): string => {
  const match = NAMED.find(
    ([, minWidth]) => globalThis.matchMedia(`(min-width: ${minWidth}px)`).matches,
  );
  return match ? match[0] : 'base';
};

/** Re-measures into the cache; `true` when the breakpoint actually changed (so React re-renders
 *  only on a real crossing — the snapshot identity is otherwise stable, as the store contract wants). */
const refresh = (): boolean => {
  const breakpoint = measure();
  if (cached.breakpoint === breakpoint) return false;
  cached = { breakpoint, isMobile: breakpoint === 'base' };
  return true;
};

const handleChange = (): void => {
  if (refresh()) {
    for (const listener of listeners) listener();
  }
};

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  if (queries === null) {
    queries = NAMED.map(([, minWidth]) =>
      globalThis.matchMedia(`(min-width: ${minWidth}px)`),
    );
    for (const query of queries) query.addEventListener('change', handleChange);
  }
  // Measure on the FIRST subscriber (and after any gap with no listeners, when a crossing could
  // have gone unheard) — that's what turns the initial `null` snapshot into the real one.
  if (refresh()) onStoreChange();

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && queries !== null) {
      for (const query of queries) query.removeEventListener('change', handleChange);
      queries = null;
    }
  };
};

const getSnapshot = (): BreakpointSnapshot => cached;

const useBreakpoint = (): BreakpointSnapshot =>
  useSyncExternalStore(subscribe, getSnapshot);

export default useBreakpoint;
