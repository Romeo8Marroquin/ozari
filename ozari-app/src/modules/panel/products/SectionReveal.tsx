import { useLayoutEffect, useRef, useState } from 'react';
import { revealSectionContent } from '../pageMotion';

interface SectionRevealProps {
  /** While true the skeleton body is shown; when it flips false the content reveal plays. */
  loading: boolean;
  /** Shimmer rows shaped like the real body (title/description stay REAL on the card). */
  skeleton: React.ReactNode;
  /** This card's slot in the cascade (multiples of `SECTION_REVEAL_STEP`). */
  delaySeconds?: number;
  /** What cascades inside the content — `.reveal-item` fields by default; a PAGE-scale reveal
   *  (the product edit page wrapping the whole form) passes `.reveal-block` so section cards ride
   *  the wave as wholes. */
  itemSelector?: string;
  /** The real body — only mounted once `loading` is false. Fields marked `.reveal-item` cascade. */
  children: React.ReactNode;
}

/**
 * The body of ONE form-section card during a data load. The card chrome (title, description) is
 * real from first paint — only this body shimmers. On load, `revealSectionContent` plays the
 * integrated swap: the shimmer dissolves, the CARD's height eases to the content's natural height,
 * and the `.reveal-item` fields cascade in — each card its own transforming object (the SkeletonFade
 * pill doctrine, per section, plus stagger). Sibling cards cascade via `delaySeconds`.
 *
 * Same overlay mechanics as `SkeletonFade`: while loading the skeleton is in flow (defining the
 * height we morph FROM); on reveal the content takes the flow and the skeleton fades out as an
 * absolute overlay, unmounting once settled. A warm cache renders the content directly, no motion.
 */
const SectionReveal: React.FC<SectionRevealProps> = ({
  loading,
  skeleton,
  delaySeconds = 0,
  itemSelector,
  children,
}) => {
  // Is the skeleton overlay in the DOM? True while loading and through the reveal; the reveal's
  // `onSettled` drops it. Starts true only if we opened in the loading state (cold load).
  const [skeletonMounted, setSkeletonMounted] = useState(loading);

  // Re-arm on RE-ENTERING loading (a refetch) so the next resolve reveals like the first time.
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setSkeletonMounted(true);
  }

  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const skeletonHeightRef = useRef(0);

  // Remember the skeleton's rendered height while it's in flow — the height we morph FROM.
  useLayoutEffect(() => {
    if (!loading) return;
    const el = wrapperRef.current;
    /* v8 ignore next -- the wrapper is always mounted while loading */
    if (!el) return;
    skeletonHeightRef.current = el.offsetHeight;
  });

  // The reveal. Re-running after `onSettled` flips `skeletonMounted` is safe: the guard returns and
  // the previous cleanup only kills an already-finished timeline.
  useLayoutEffect(() => {
    if (loading || !skeletonMounted) return;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    const overlay = overlayRef.current;
    /* v8 ignore next -- all three layers are mounted whenever a reveal runs */
    if (!wrapper || !content || !overlay) return;
    return revealSectionContent(wrapper, content, overlay, {
      skeletonHeight: skeletonHeightRef.current,
      delaySeconds,
      onSettled: () => setSkeletonMounted(false),
      ...(itemSelector !== undefined && { itemSelector }),
    });
  }, [loading, skeletonMounted, delaySeconds, itemSelector]);

  // `pt-6 -mt-6`: the reveal clips overflow while morphing the height, and the FIRST field's
  // floating label rises ~1rem ABOVE the body's top edge — without headroom it gets clipped for
  // the duration of the reveal (the "label appears late" glitch). Padding keeps that zone INSIDE
  // the clip box; the negative margin cancels it visually. The overlay starts at `top-6` so both
  // layers align to the same content origin.
  return (
    <div ref={wrapperRef} className="relative pt-6 -mt-6">
      {loading ? (
        <div>{skeleton}</div>
      ) : (
        <>
          <div ref={contentRef}>{children}</div>
          {skeletonMounted && (
            <div ref={overlayRef} aria-hidden className="absolute inset-x-0 top-6">
              {skeleton}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SectionReveal;
