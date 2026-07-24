import { useEffect, useRef, useState } from 'react';

/** How long after the last scroll/proximity signal the thumb fades away. */
export const SCROLLBAR_IDLE_HIDE_MS = 900;
/** Pointer-within-this-many-px of the right edge counts as "reaching for the bar". */
const EDGE_PROXIMITY_PX = 28;
/** Track inset from the container edges (keeps the thumb clear of rounded corners/header seam). */
const TRACK_INSET_PX = 4;
/** The thumb never shrinks below this, however long the content (stays grabbable). */
const MIN_THUMB_PX = 36;

interface OverlayScrollbarProps {
  /** The scroll container this bar mirrors (its native bar hidden via `.no-native-scrollbar`). */
  target: React.RefObject<HTMLElement | null>;
}

/**
 * THE app's single scrollbar — a floating OVERLAY bar shared by every scroll area (the panel main,
 * modal bodies, any inner scroll region). The native bar is hidden on the target (it occupies layout
 * space, so content jumped sideways whenever overflow appeared/disappeared); this bar floats OVER the
 * content instead: zero layout space, so nothing shifts. It fades in while scrolling or when the
 * pointer approaches the right edge, widens (with a pointer cursor) under the pointer, drags like the
 * real thing, and fades away when idle. Purely visual + a drag affordance — wheel/keyboard/touch
 * scrolling is still the native element's (hiding a scrollbar changes nothing about scrollability).
 *
 * Usage: give the scroll container `.no-native-scrollbar` + `position: relative` on a wrapper that
 * holds BOTH the scroll container and this bar as siblings, then `<OverlayScrollbar target={ref} />`.
 *
 * Layering: it sits inside its own content column (absolute), above static content; every floating
 * layer (menus, drawers, modals, notifications) is portaled to `<body>` on the `--z-*` scale, so they
 * all paint over it. `aria-hidden`: assistive tech already has the scrollable region.
 */
const OverlayScrollbar: React.FC<OverlayScrollbarProps> = ({ target }) => {
  // null = no overflow (nothing to show); otherwise the thumb's geometry within the track.
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  // "Engaged" = recently scrolled or pointer near the edge → the thumb is visible.
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const hoveringThumb = useRef(false);
  const draggingRef = useRef(false);
  const dragStart = useRef({ pointerY: 0, scrollTop: 0 });

  /** Recompute the thumb from the live scroll metrics (scroll, resize, content growth). */
  const sync = (): void => {
    const element = target.current;
    /* v8 ignore next -- defensive: sync only ever fires from listeners bound while the target existed */
    if (!element) return;
    const { scrollHeight, clientHeight, scrollTop } = element;
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const trackHeight = clientHeight - TRACK_INSET_PX * 2;
    const height = Math.max(MIN_THUMB_PX, (trackHeight * clientHeight) / scrollHeight);
    const maxOffset = trackHeight - height;
    const progress = scrollTop / (scrollHeight - clientHeight);
    setThumb({ top: TRACK_INSET_PX + maxOffset * progress, height });
  };

  /** Show the thumb now and re-arm the idle fade (suspended while dragging/hovering it). */
  const wake = (): void => {
    setEngaged(true);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!draggingRef.current && !hoveringThumb.current) setEngaged(false);
    }, SCROLLBAR_IDLE_HIDE_MS);
  };

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    // The initial measure waits a frame: a synchronous setState inside the effect would cascade
    // renders (React Compiler lint) — and the layout is only final by then anyway.
    const initialMeasure = requestAnimationFrame(sync);

    const onScroll = (): void => {
      sync();
      wake();
    };
    element.addEventListener('scroll', onScroll, { passive: true });

    // Reaching toward the right edge reveals the bar without it ever intercepting content clicks.
    const onPointerMove = (event: PointerEvent): void => {
      const box = element.getBoundingClientRect();
      if (box.right - event.clientX <= EDGE_PROXIMITY_PX) wake();
    };
    element.addEventListener('pointermove', onPointerMove, { passive: true });

    // Content growing/shrinking (skeleton → cards, appended pages, collapsed filters) resizes the
    // thumb — or removes it entirely — without any scroll event happening.
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);

    return () => {
      cancelAnimationFrame(initialMeasure);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('pointermove', onPointerMove);
      observer.disconnect();
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync/wake are compiler-memoized helpers
  }, [target]);

  // Dragging maps pointer travel to scroll travel (window listeners so the grab survives leaving
  // the thumb — the standard scrollbar feel).
  const onThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = target.current;
    /* v8 ignore next -- defensive: the thumb only renders while the target's metrics exist */
    if (!element) return;
    event.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    dragStart.current = { pointerY: event.clientY, scrollTop: element.scrollTop };

    const onMove = (move: PointerEvent): void => {
      const { scrollHeight, clientHeight } = element;
      const trackHeight = clientHeight - TRACK_INSET_PX * 2;
      const thumbHeight = Math.max(MIN_THUMB_PX, (trackHeight * clientHeight) / scrollHeight);
      const scrollable = scrollHeight - clientHeight;
      const draggable = trackHeight - thumbHeight;
      /* v8 ignore next -- the thumb only exists while the content overflows, so draggable > 0 */
      if (draggable <= 0) return;
      const delta = move.clientY - dragStart.current.pointerY;
      element.scrollTop = dragStart.current.scrollTop + (delta * scrollable) / draggable;
    };
    const onUp = (): void => {
      draggingRef.current = false;
      setDragging(false);
      wake(); // start the idle countdown from the release
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-1 w-3">
      {thumb && (
        <div
          data-testid="overlay-scrollbar-thumb"
          onPointerDown={onThumbPointerDown}
          onPointerEnter={() => {
            hoveringThumb.current = true;
            wake();
          }}
          onPointerLeave={() => {
            hoveringThumb.current = false;
            wake();
          }}
          className={`pointer-events-auto absolute right-0 cursor-pointer rounded-full transition-[opacity,width,background-color] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
            engaged || dragging ? 'opacity-100' : 'opacity-0'
          } ${dragging ? 'w-2.5 bg-charcoal/45' : 'w-1.5 bg-charcoal/25 hover:w-2.5 hover:bg-charcoal/40'}`}
          style={{ top: thumb.top, height: thumb.height }}
        />
      )}
    </div>
  );
};

export default OverlayScrollbar;
