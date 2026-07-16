import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  animateGalleryReorder,
  captureGalleryLayout,
  galleryDragLift,
  galleryDragMove,
  galleryDragSettle,
  getTileRestingRect,
} from '../pageMotion';
import { computeDragTranslation, dragDistance, findReorderIndex } from './galleryReorder';
import type { GalleryImage } from './useGalleryImages';

/** Movement (px) that turns a fine-pointer press into a drag — under it, it's a click. */
const DRAG_THRESHOLD_PX = 6;
/** Touch: movement past this before the hold elapses means the user is SCROLLING — stand down. */
const TOUCH_SCROLL_TOLERANCE_PX = 10;
/** Touch: how long a still press must be held before the tile lifts (then dragging owns the gesture). */
const TOUCH_HOLD_MS = 220;

interface DragSession {
  id: string;
  pointerId: number;
  el: HTMLElement;
  /** Grab point inside the tile — the drag pins this exact spot under the pointer. */
  grabOffset: { x: number; y: number };
  start: { x: number; y: number };
  last: { x: number; y: number };
  /** The translation WE have applied (the only writer is galleryDragMove), so the resting origin
   *  is always recoverable without reading the transform back from GSAP. */
  translation: { x: number; y: number };
  active: boolean;
  holdTimer: number | null;
}

export interface GalleryThumbDragHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
}

export interface GalleryDragState {
  /** The tile currently in hand (styling: elevated shadow, grabbing cursor), or null. */
  draggingId: string | null;
  getThumbHandlers: (id: string) => GalleryThumbDragHandlers;
}

interface UseGalleryDragOptions {
  disabled: boolean;
  images: GalleryImage[];
  moveImage: (id: string, toIndex: number) => void;
  /** The FLIP scope (the gallery swap container). */
  scopeRef: React.RefObject<HTMLDivElement | null>;
  /** The rendered thumbnails, keyed by local image id (the component already maintains this). */
  thumbRefs: React.RefObject<Map<string, HTMLLIElement>>;
}

/**
 * Drag-to-reorder for the photo gallery — the CARD itself moves (never the browser's phantom image
 * copy): pointer-based, so one path serves mouse, pen and touch. The interaction contract:
 *
 * - A fine-pointer press becomes a drag after {@link DRAG_THRESHOLD_PX}; under that it stays a
 *   click (the star/✕ buttons never start a drag at all — presses on them are ignored here).
 * - Touch lifts the tile after a still {@link TOUCH_HOLD_MS} hold; moving beyond
 *   {@link TOUCH_SCROLL_TOLERANCE_PX} first means the user is scrolling and the press stands down.
 *   While a touch drag is active, a non-passive `touchmove` listener suppresses scrolling.
 * - The lifted tile is pinned under the pointer ({@link galleryDragMove}); crossing another tile's
 *   box commits the reorder immediately — siblings FLIP-glide to their new cells while the tile in
 *   hand stays put ({@link animateGalleryReorder}), so the user *sees* the final order live.
 * - Release settles the tile into its cell ({@link galleryDragSettle}); the ORDER is the state that
 *   was already committed mid-drag, so drop position needs no second reconciliation.
 * - The star (primary) rides the image id, never the slot — reordering never moves it.
 */
export function useGalleryDrag({
  disabled,
  images,
  moveImage,
  scopeRef,
  thumbRefs,
}: UseGalleryDragOptions): GalleryDragState {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const session = useRef<DragSession | null>(null);
  // Captured just before a mid-drag reorder commits; consumed by the post-commit layout effect.
  const pendingFlip = useRef<ReturnType<typeof captureGalleryLayout>>(null);
  // Live mirror of the display order for the pointermove hit test (no stale closures).
  const orderRef = useRef(images);
  useEffect(() => {
    orderRef.current = images;
  }, [images]);

  // While a TOUCH drag is active, scrolling must not steal the gesture: a non-passive listener
  // preventDefaults touchmove (CSS `touch-action` can't change mid-gesture, so it can't help here).
  const suppressTouchScroll = useCallback((event: TouchEvent) => {
    /* v8 ignore next -- the listener only exists while a session is active; the guard is defensive */
    if (session.current?.active) event.preventDefault();
  }, []);

  const activate = useCallback(
    (drag: DragSession) => {
      drag.active = true;
      if (drag.holdTimer !== null) {
        window.clearTimeout(drag.holdTimer);
        drag.holdTimer = null;
      }
      setDraggingId(drag.id);
      galleryDragLift(drag.el);
      window.addEventListener('touchmove', suppressTouchScroll, { passive: false });
    },
    [suppressTouchScroll],
  );

  const teardown = useCallback(() => {
    const drag = session.current;
    if (!drag) return;
    if (drag.holdTimer !== null) window.clearTimeout(drag.holdTimer);
    window.removeEventListener('touchmove', suppressTouchScroll);
    session.current = null;
    if (drag.active) {
      void galleryDragSettle(drag.el).then(() => {
        // Keep the elevated styling until the tile lands — dropping it mid-flight looks broken.
        setDraggingId((current) => (current === drag.id ? null : current));
      });
    }
  }, [suppressTouchScroll]);

  // Unmount / mid-drag freeze (the form started submitting): abandon any session cleanly.
  useEffect(() => {
    if (disabled) teardown();
  }, [disabled, teardown]);
  useEffect(() => () => teardown(), [teardown]);

  // After a mid-drag reorder commits, two things must happen BEFORE paint: the dragged tile's
  // translation is recomputed against its NEW resting cell (so it never leaves the pointer), and
  // the survivors FLIP from the captured layout to their new cells.
  const orderKey = images.map((image) => image.id).join('|');
  useLayoutEffect(() => {
    const drag = session.current;
    const state = pendingFlip.current;
    pendingFlip.current = null;
    if (!drag?.active || !state) return;
    const rect = drag.el.getBoundingClientRect();
    const next = computeDragTranslation(drag.last, drag.grabOffset, rect, drag.translation);
    drag.translation = next;
    galleryDragMove(drag.el, next.x, next.y);
    animateGalleryReorder(scopeRef.current, state, drag.el);
  }, [orderKey, scopeRef]);

  const onPointerDown = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (disabled || session.current) return;
      // Presses on the tile's own controls (star/✕) are theirs — never the start of a drag.
      if ((event.target as HTMLElement).closest('button')) return;
      if (event.button !== 0) return;
      const el = event.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const drag: DragSession = {
        id,
        pointerId: event.pointerId,
        el,
        grabOffset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        start: { x: event.clientX, y: event.clientY },
        last: { x: event.clientX, y: event.clientY },
        translation: { x: 0, y: 0 },
        active: false,
        holdTimer: null,
      };
      session.current = drag;
      el.setPointerCapture(event.pointerId);
      if (event.pointerType === 'touch') {
        // A still hold lifts the tile; early movement means scrolling (see onPointerMove).
        drag.holdTimer = window.setTimeout(() => {
          /* v8 ignore next -- the timer is cleared on every teardown path; the guard is defensive */
          if (session.current === drag && !drag.active) activate(drag);
        }, TOUCH_HOLD_MS);
      }
    },
    [disabled, activate],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = session.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      drag.last = point;

      if (!drag.active) {
        const travelled = dragDistance(point, drag.start);
        if (event.pointerType === 'touch') {
          // Moving before the hold elapsed = the user is scrolling the page. Stand down entirely.
          if (travelled > TOUCH_SCROLL_TOLERANCE_PX) teardown();
          return;
        }
        if (travelled <= DRAG_THRESHOLD_PX) return;
        // Activation falls through to the tracking below: the tile pins under the pointer on the
        // very move that lifted it — no one-move lag.
        activate(drag);
      }

      // Pin the tile under the pointer…
      const rect = drag.el.getBoundingClientRect();
      const next = computeDragTranslation(point, drag.grabOffset, rect, drag.translation);
      drag.translation = next;
      galleryDragMove(drag.el, next.x, next.y);

      // …and commit the reorder the moment the pointer crosses another tile's box. The hit test
      // runs against RESTING rects (live rect minus in-flight transform): while the FLIP glide
      // plays, a displaced tile still covers its old cell, and testing live boxes would re-trigger
      // the swap it's animating away from — the order thrashes and the glide never gets to play.
      const order = orderRef.current.map((image) => image.id);
      const targetIndex = findReorderIndex(point, order, (imageId) => {
        if (imageId === drag.id) return null;
        const thumb = thumbRefs.current.get(imageId);
        return thumb ? getTileRestingRect(thumb) : null;
      });
      const currentIndex = order.indexOf(drag.id);
      if (targetIndex !== null && targetIndex !== currentIndex) {
        pendingFlip.current = captureGalleryLayout(scopeRef.current);
        moveImage(drag.id, targetIndex);
      }
    },
    [activate, teardown, moveImage, scopeRef, thumbRefs],
  );

  const onPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = session.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      teardown();
    },
    [teardown],
  );

  const getThumbHandlers = useCallback(
    (id: string): GalleryThumbDragHandlers => ({
      onPointerDown: (event) => onPointerDown(id, event),
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    }),
    [onPointerDown, onPointerMove, onPointerEnd],
  );

  return { draggingId, getThumbHandlers };
}
