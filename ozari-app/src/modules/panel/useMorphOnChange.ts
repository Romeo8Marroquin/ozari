import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  animateHeightFrom,
  animateListReflow,
  captureGalleryLayout,
  isRegionSettling,
  panelScroller,
} from './pageMotion';

/** What the region looked like after the last commit — the frame the next change animates FROM. */
interface RegionSnapshot {
  key: string | number;
  /** The key the ITEMS were last identified by, so a change that only resized the region (an editor
   *  opening) can be told from one that actually moved rows. */
  itemsKey: string | number;
  height: number;
  state: ReturnType<typeof captureGalleryLayout>;
  /** False when it was taken while something was still moving, so the boxes it holds are a lie.
   *  An untrusted snapshot eases the height and skips the glide rather than inventing a journey. */
  trusted: boolean;
  /** The panel's scroll offset the boxes were recorded at (null outside the panel). */
  scrollTop: number | null;
}

/**
 * Make a REGION adapt when the data behind it changes, instead of repainting: the container's height
 * eases from what it was to what it now needs, the marked items that survived the change GLIDE from
 * their old boxes to their new ones, and the items the change ADDED rise in. It is the agenda
 * ticket's "grow, adapt, repaint" read (`MorphSwap`) generalised from one inline label to a whole
 * block — used on the order detail so advancing a step reflows the state card, the logistics facts
 * and the history trail smoothly rather than swapping them in one frame.
 *
 * Because the height eases in NORMAL FLOW, everything below the region slides with it for free — no
 * page-level choreography is needed, and (importantly) no two nested height tweens ever fight.
 *
 * `swapKey` is the identity of the CONTENT: re-rendering the same key (a background refetch handing
 * back equal data) animates nothing. `itemSelector` is optional — without it only the height eases;
 * with it, the matching elements must carry a `data-flip-id` so survivors can be told from arrivals.
 *
 * `itemsKey` separates the two halves when they are not the same question (owner rule 2026-08-05).
 * A catalog card's height depends on BOTH its rows and whether an editor is open, but its rows only
 * move when the ROWS change: keyed on `swapKey` alone, opening the inline form re-ran the glide over
 * every row, so the whole list drifted for a change that had not moved a single one of them. Pass
 * the rows' own identity here and the box grows while the list stays perfectly still. Omitted, it
 * follows `swapKey`, which is right wherever size and items change together (the order detail).
 */
export default function useMorphOnChange<T extends HTMLElement = HTMLDivElement>(
  swapKey: string | number,
  itemSelector?: string,
  itemsKey: string | number = swapKey,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const previous = useRef<RegionSnapshot | null>(null);
  /** The pending re-capture frame — one at a time, and cancelled on unmount. */
  const frame = useRef(0);

  /**
   * Record the region as it stands right now, and say whether that record can be believed.
   *
   * `interrupt` is true ONLY for the capture taken at a real change, where a glide still running
   * from the previous one must finish before the next starts. Every other capture is a passive
   * record — the settle loop, a same-key commit, a scroll — and must leave a running glide alone:
   * an interrupting capture there finished it on its second frame (see `captureGalleryLayout`).
   */
  const capture = (element: T, interrupt = false): void => {
    previous.current = {
      key: swapKey,
      itemsKey,
      // Measured BEFORE animating: `animateHeightFrom` pins its from-height synchronously, so
      // reading afterwards would record the height we are easing away from as if it were the new one.
      height: element.offsetHeight,
      state:
        itemSelector === undefined ? null : captureGalleryLayout(element, itemSelector, interrupt),
      trusted: !isRegionSettling(element, itemSelector),
      scrollTop: panelScroller()?.scrollTop ?? null,
    };
  };

  /**
   * Keep re-capturing until everything has come to rest.
   *
   * A snapshot taken mid-entrance is worthless, and there is no re-render when a tween ends to
   * replace it — so the region watches for the stillness itself. One frame's work while an
   * animation is already running, and it stops the moment nothing is moving, which is also the
   * moment the record becomes true.
   */
  const settle = (): void => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = ref.current;
      if (!element || previous.current === null) return;
      const { key, itemsKey: items } = previous.current;
      capture(element);
      // `capture` stamps the CURRENT keys; this loop is only refreshing geometry, so the identity
      // it was taken under has to survive or a pending change would look like it had been handled.
      previous.current = { ...previous.current, key, itemsKey: items };
      if (!previous.current.trusted) settle();
    });
  };

  // No dependency array on purpose: the region is measured after EVERY commit, so what's recorded
  // is always the frame the next change will animate FROM.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const before = previous.current;
    const changed = before !== null && before.key !== swapKey;
    capture(element, changed);
    if (!changed) return;
    animateHeightFrom(element, before.height);
    // ⚠️ Measuring the new state laid out a region that may now be SHORTER, and if this region sits
    // near the bottom of the panel the browser clamped the scroll on that read — before the height
    // above was pinned back — so the whole page jumped down by up to the size of what left (a
    // removed subscription block at the foot of Ajustes: ~170–270px in one frame). The pin has
    // restored the room, so restore the offset too; the height then eases shut and the clamp rides
    // down with it, which is the behaviour `revealInScroller` documents for a removal.
    const scroller = panelScroller();
    if (scroller && before.scrollTop !== null && scroller.scrollTop < before.scrollTop) {
      scroller.scrollTop = before.scrollTop;
    }
    // The glide runs only when the ITEMS moved, and only from boxes we actually trust.
    if (itemSelector !== undefined && before.trusted && before.itemsKey !== itemsKey) {
      animateListReflow(element, itemSelector, before.state, true);
    }
    // The height tween just started, so the record taken a moment ago is already out of date.
    settle();
  });

  /**
   * Keep the snapshot honest while the user SCROLLS.
   *
   * A Flip state records VIEWPORT rects, and GSAP compensates only for the DOCUMENT's scroll
   * (`_getDocScrollTop`) — but the panel scrolls inside its own `main.panel-main` container, which
   * GSAP cannot see. So a snapshot taken on mount, followed by the user scrolling down to reach this
   * card, described boxes that had all since moved by the scroll delta: the next change then glided
   * the WHOLE list by that amount before settling. It read as "the list did a weird little animation",
   * it got worse the further you had scrolled, and it stopped after one interaction — because that
   * interaction re-snapshotted at the new position.
   *
   * Re-snapshotting as the panel scrolls fixes it at the source. Coalesced to one frame, and only for
   * regions that actually track items (a height-only region has no rects to go stale).
   *
   * The recorded OFFSET is kept for every region, and synchronously: it is what the clamp repair in
   * the layout effect restores, so a stale one would yank the page back to where the user scrolled
   * away from. (Synchronous is safe — the browser delivers the clamp's own scroll event on a later
   * frame, after the repair has already run.)
   */
  useEffect(() => {
    const scroller = panelScroller();
    if (!scroller) return;
    let scrollFrame = 0;
    const resnapshot = (): void => {
      scrollFrame = 0;
      const element = ref.current;
      const record = previous.current;
      if (!element || !record || itemSelector === undefined) return;
      // Passive: a scroll mid-glide (`revealInScroller` following a new block down) must not end it.
      record.state = captureGalleryLayout(element, itemSelector, false);
      record.trusted = !isRegionSettling(element, itemSelector);
    };
    const onScroll = (): void => {
      if (previous.current) previous.current.scrollTop = scroller.scrollTop;
      if (itemSelector !== undefined && scrollFrame === 0) {
        scrollFrame = requestAnimationFrame(resnapshot);
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
    };
  }, [itemSelector]);

  useEffect(
    () => () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return ref;
}
