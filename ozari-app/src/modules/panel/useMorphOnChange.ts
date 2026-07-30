import { useEffect, useLayoutEffect, useRef } from 'react';
import { animateHeightFrom, animateListReflow, captureGalleryLayout, panelScroller } from './pageMotion';

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
 */
export default function useMorphOnChange<T extends HTMLElement = HTMLDivElement>(
  swapKey: string | number,
  itemSelector?: string,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const previous = useRef<{
    key: string | number;
    height: number;
    state: ReturnType<typeof captureGalleryLayout>;
  } | null>(null);

  // No dependency array on purpose: the region is measured after EVERY commit, so what's recorded
  // is always the frame the next change will animate FROM.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Measure and capture BEFORE animating — `animateHeightFrom` pins its from-height synchronously,
    // so reading afterwards would record the height we are easing away from as if it were the new one.
    const height = element.offsetHeight;
    const state = itemSelector === undefined ? null : captureGalleryLayout(element, itemSelector);
    const before = previous.current;
    previous.current = { key: swapKey, height, state };
    if (before === null || before.key === swapKey) return;
    animateHeightFrom(element, before.height);
    if (itemSelector !== undefined) animateListReflow(element, itemSelector, before.state);
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
   */
  useEffect(() => {
    if (itemSelector === undefined) return;
    const scroller = panelScroller();
    if (!scroller) return;
    let frame = 0;
    const resnapshot = (): void => {
      frame = 0;
      const element = ref.current;
      const record = previous.current;
      if (!element || !record) return;
      record.state = captureGalleryLayout(element, itemSelector);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(resnapshot);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [itemSelector]);

  return ref;
}
