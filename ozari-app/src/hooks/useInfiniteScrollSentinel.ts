import { useEffect, useRef } from 'react';

interface InfiniteScrollSentinelOptions {
  /** Fired when the sentinel scrolls into (extended) view — "load the next page". */
  onReach: () => void;
  /** While true the observer is torn down (nothing more to load, a fetch in flight, an error…). */
  disabled: boolean;
  /**
   * How far BELOW the viewport the sentinel already counts as reached, so the next page starts
   * loading before the user actually hits the bottom (the fetch races the remaining scroll).
   */
  rootMargin?: string;
}

/**
 * Infinite scroll's trigger: returns a ref for an (invisible) sentinel element placed after the
 * list; when it approaches the viewport, `onReach` fires. IntersectionObserver measures against the
 * viewport regardless of which ancestor scrolls, so this works inside the panel's `overflow-y-auto`
 * main without knowing about it. `onReach` is kept in a ref so a new callback identity never
 * re-creates the observer; `disabled` gates re-observation (each page load disables → re-enables,
 * which re-fires the observer if the sentinel is STILL visible — short pages keep loading until the
 * viewport is filled or the list ends, no scroll event needed).
 */
export function useInfiniteScrollSentinel({
  onReach,
  disabled,
  rootMargin = '600px 0px',
}: InfiniteScrollSentinelOptions): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onReachRef = useRef(onReach);
  // Kept fresh in an effect (not during render — the React Compiler lint forbids that); the
  // observer only fires asynchronously, well after effects have run.
  useEffect(() => {
    onReachRef.current = onReach;
  });

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (disabled || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReachRef.current();
      },
      { rootMargin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [disabled, rootMargin]);

  return sentinelRef;
}
