import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@utils/motion';
import {
  captureElements,
  detailRowIn,
  detailRowOut,
  glideReorder,
  restoreListItem,
  revealInScroller,
} from './pageMotion';

/** A reorder snapshot waiting for its commit. */
interface PendingGlide {
  ids: string[];
  state: ReturnType<typeof captureElements>;
  /** The control that had focus, so a node React MOVED (and the browser blurred) gets it back. */
  focus: HTMLElement | null;
}

/** Where focus goes once a removal commits, if it was inside what left. */
interface PendingFocus {
  neighbour: string | null;
  fallback?: () => HTMLElement | null | undefined;
}

export interface LeaveOptions {
  /** Focus target when no neighbouring item is left (the list's "add" button). */
  focusFallback?: () => HTMLElement | null | undefined;
}

export interface ListMotion {
  /** The ref callback for item `id` — stable per id. Mark every item that can enter or leave. */
  item: (id: string) => (element: HTMLElement | null) => void;
  /** The item `id` is about to be ADDED by the user: when it mounts, the panel follows it into view
   *  (adding something is a request to see it — `revealInScroller`). */
  reveal: (id: string) => void;
  /**
   * Animate the items OUT (each slides away while its space closes — `detailRowOut`), THEN run
   * `commit`, which must read the LATEST state (it runs a beat later; anything typed or removed
   * meanwhile must survive). Ignored while any of `ids` is already leaving. If focus was inside what
   * left, it moves to the nearest surviving item (its `[data-focus-on-remove]` control, else its
   * first enabled control) or to `focusFallback`.
   */
  leave: (ids: string[], commit: () => void, options?: LeaveOptions) => void;
  /** Snapshot `ids`, run `commit` (which moves them), then glide every one to its new place. */
  reorder: (ids: string[], commit: () => void) => void;
  /** The ids currently on their way out (a control can read "already gone" before the commit). */
  leaving: ReadonlySet<string>;
}

/** The flex/grid gap the item's container puts after it — what its exit and entrance swallow. */
const gapOf = (element: HTMLElement): number =>
  // A mounted item always has a parent (the list).
  Number.parseFloat(getComputedStyle(element.parentElement as HTMLElement).rowGap) || 0;

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/** The best control inside `element` to hand focus to. */
const focusTargetIn = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>('[data-focus-on-remove]:not(:disabled)') ??
  element.querySelector<HTMLElement>(FOCUSABLE);

/**
 * The motion of a list whose ITEMS come and go — options, values, variation rows: the one helper
 * for "an item enters / leaves / reorders, and its space opens or closes so everything below
 * glides". It packages the app's list vocabulary rather than inventing any:
 *
 * - **Enter** — an item that mounts AFTER the list's first commit grows its space open while it
 *   slides in (`detailRowIn`, 0.35s `power3.out`); items present at mount ride the page's own
 *   entrance and never replay it.
 * - **Leave** — two-phase, like every removal here: the item slides out while its space eases shut
 *   (`detailRowOut`, 0.2s out + 0.3s collapse), and only THEN does the state change commit — so the
 *   content below glides up instead of snapping, and the commit reads the latest state.
 * - **Reorder** — a just-in-time FLIP (`captureElements` → commit → `glideReorder`, 0.35s
 *   `power3.out`): captured immediately before the commit and consumed by the very next one, so the
 *   panel scroll can never make it stale.
 *
 * Interruption is the helpers' job and holds by construction: every tween overwrites the item's
 * previous one (a quick add → remove collapses from the half-grown frame), a reorder releases items
 * still entering before it glides, and an item that survives its own exit (a commit that kept it) is
 * restored rather than left collapsed. Each item's gap is read from its container, so a 12px and a
 * 20px list need no configuration. Reduced motion: every change commits at once.
 */
export default function useListMotion(): ListMotion {
  const elements = useRef(new Map<string, HTMLElement>());
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const armed = useRef(false);
  const entering = useRef(new Set<string>());
  const toReveal = useRef(new Set<string>());
  const leavingRef = useRef(new Set<string>());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const pendingGlide = useRef<PendingGlide | null>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  /** Ids whose exit finished and whose commit ran — any still mounted next commit is restored. */
  const settled = useRef<string[]>([]);

  const item = useCallback((id: string) => {
    const existing = callbacks.current.get(id);
    if (existing) return existing;
    const callback = (element: HTMLElement | null): void => {
      if (!element) {
        elements.current.delete(id);
        return;
      }
      elements.current.set(id, element);
      element.setAttribute('data-list-item', id);
      // Played by the layout effect, once the whole commit is attached: an item mounting INSIDE
      // another that is entering too (a new row's own fields) rides its parent's growth instead of
      // running a second, nested one.
      if (armed.current) entering.current.add(id);
    };
    callbacks.current.set(id, callback);
    return callback;
  }, []);

  const reveal = useCallback((id: string) => {
    toReveal.current.add(id);
  }, []);

  const leave = useCallback((ids: string[], commit: () => void, options?: LeaveOptions) => {
    if (ids.some((id) => leavingRef.current.has(id))) return;
    const leavingElements = ids.flatMap((id) => elements.current.get(id) ?? []);
    const active = document.activeElement;
    const hadFocus = leavingElements.some((element) => element.contains(active));
    pendingFocus.current = hadFocus
      ? { neighbour: neighbourOf(leavingElements[0], new Set(ids)), fallback: options?.focusFallback }
      : null;

    if (prefersReducedMotion() || leavingElements.length === 0) {
      settled.current = ids;
      commit();
      return;
    }
    for (const id of ids) leavingRef.current.add(id);
    setLeaving(new Set(leavingRef.current));
    for (const element of leavingElements) element.setAttribute('data-leaving', '');
    void Promise.all(leavingElements.map((element) => detailRowOut(element, gapOf(element)))).then(() => {
      for (const id of ids) leavingRef.current.delete(id);
      setLeaving(new Set(leavingRef.current));
      settled.current = ids;
      commit();
    });
  }, []);

  const reorder = useCallback((ids: string[], commit: () => void) => {
    const tracked = ids.flatMap((id) => elements.current.get(id) ?? []);
    const active = document.activeElement;
    pendingGlide.current = {
      ids,
      state: captureElements(tracked),
      focus: active instanceof HTMLElement && tracked.some((element) => element.contains(active)) ? active : null,
    };
    commit();
  }, []);

  // Arm one frame AFTER mount: everything in the first commit rides the page's own entrance, and
  // StrictMode's dev-only detach/re-attach of refs (which happens inside that window) must not read
  // as the whole list being added.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      armed.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // No dependency array: every commit is checked for a pending glide, focus hand-off or survivor.
  useLayoutEffect(() => {
    const arrivals = [...entering.current].flatMap((id) => {
      const element = elements.current.get(id);
      /* v8 ignore next -- defensive: an item mounted and unmounted within one commit */
      return element ? [{ id, element }] : [];
    });
    entering.current.clear();
    for (const { id, element } of arrivals) {
      const nested = arrivals.some((other) => other.element !== element && other.element.contains(element));
      if (!nested) detailRowIn(element, gapOf(element));
      if (toReveal.current.delete(id)) revealInScroller(element);
    }

    const glide = pendingGlide.current;
    if (glide) {
      pendingGlide.current = null;
      glideReorder(glide.ids.flatMap((id) => elements.current.get(id) ?? []), glide.state);
      if (glide.focus && (document.activeElement !== glide.focus || isDisabled(glide.focus))) {
        refocus(glide.focus);
      }
    }

    // Only the render a leave COMMITTED in settles it — the render that marked the items as leaving
    // (focus still inside them) must not consume the hand-off.
    const committed = settled.current;
    if (committed.length === 0) return;
    settled.current = [];
    // An item whose exit ran but which the commit KEPT must not stay collapsed and faded.
    for (const element of committed.flatMap((id) => elements.current.get(id) ?? [])) {
      element.removeAttribute('data-leaving');
      restoreListItem(element);
    }

    const focus = pendingFocus.current;
    pendingFocus.current = null;
    if (focus && focusIsLost()) {
      const neighbour = focus.neighbour === null ? undefined : elements.current.get(focus.neighbour);
      const target = (neighbour && focusTargetIn(neighbour)) ?? focus.fallback?.();
      target?.focus({ preventScroll: true });
    }
  });

  return { item, reveal, leave, reorder, leaving };
}

/** The nearest list item after `element` (else before it) that is not leaving too. */
function neighbourOf(element: HTMLElement, leavingIds: Set<string>): string | null {
  for (const direction of ['nextElementSibling', 'previousElementSibling'] as const) {
    for (let node = element[direction]; node; node = node[direction]) {
      const id = node.getAttribute('data-list-item');
      if (id !== null && !leavingIds.has(id)) return id;
    }
  }
  return null;
}

/** Focus fell to the document (its element left the DOM) rather than to something the user chose. */
const focusIsLost = (): boolean =>
  document.activeElement === null || document.activeElement === document.body;

/** Give focus back to a control React moved (moving a node can blur it). A control that just
 *  became disabled (a "move up" that reached the top) hands it to its first enabled sibling. */
function refocus(control: HTMLElement): void {
  if (!isDisabled(control)) {
    control.focus({ preventScroll: true });
    return;
  }
  control.parentElement?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
}

const isDisabled = (control: HTMLElement): boolean => (control as HTMLButtonElement).disabled === true;
