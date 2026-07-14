import gsap from 'gsap';
import { useLayoutEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { prefersReducedMotion } from '@utils/motion';

export interface SkeletonFadeProps {
  /** While true the skeleton is shown; when it flips false the real content crossfades in. */
  loading: boolean;
  /** Placeholder markup, shaped like the real content. */
  skeleton: React.ReactNode;
  /** The real content — only mounted once `loading` is false. */
  children: React.ReactNode;
  /** Wrapper classes. The wrapper is `relative` so the skeleton can overlay content during the fade. */
  className?: string;
  /**
   * Classes applied to EACH layer (skeleton + content). Set the layers' display/layout here (e.g.
   * `flex items-center gap-4`, `inline-block`) so both states lay out identically — the fade layer is
   * a real box, so a flex/inline caller must push its layout down onto it.
   */
  contentClassName?: string;
  /**
   * Also morph the wrapper's SIZE from the skeleton to the content on reveal, in step with the
   * crossfade — for a container whose size depends on the data so it eases open/closed instead of
   * snapping. `true`/`'width'` = width only (e.g. the header pill adapting to the user's name);
   * `'height'` = height only (e.g. a block column whose skeleton approximates the final sections);
   * `'both'` = both axes. Opt-in; fixed-size loaders don't need it. Needs a real `className` display
   * where the dimension applies (a flex item, `inline-block`, `block`, …).
   */
  animateSize?: boolean | 'width' | 'height' | 'both';
  /** Crossfade duration (ms). Also the size-morph duration when `animateSize`. */
  durationMs?: number;
}

/**
 * Crossfades a skeleton placeholder into real content — no pop, no movement, just opacity.
 *
 * While loading, the skeleton sits in normal flow (defining the layout). The instant the data lands,
 * the real content takes that place in flow (so its own size/alignment is preserved) and the skeleton
 * fades out as an absolute overlay on top of it, then unmounts once the fade finishes. If the data is
 * already present on first paint (e.g. a warm cache), the content renders straight away with no fade.
 *
 * The reveal is a single GSAP tween pair (content opacity in, skeleton opacity out) — one mechanism
 * so the two never fight or mis-time (a CSS-transition + rAF approach was fragile, especially next to
 * the size morph). With `animateSize`, the wrapper width and/or height additionally eases from the
 * skeleton's size to the content's natural size, concurrently. Reduced-motion → instant. Shared by
 * every skeleton loader (settings, the header pill/menu, the MFA setup modal, the product create
 * form) so "loading → loaded" reads the same.
 */
const SkeletonFade: React.FC<SkeletonFadeProps> = ({
  loading,
  skeleton,
  children,
  className,
  contentClassName,
  animateSize = false,
  durationMs = 400,
}) => {
  // Is the skeleton overlay in the DOM? True while loading and while it fades out afterwards; the
  // fade's onComplete drops it. Starts true only if we opened in the loading state.
  const [skeletonMounted, setSkeletonMounted] = useState(loading);

  // Re-arm whenever we RE-ENTER the loading state (a reused modal reopening, a query refetch, …) so
  // the skeleton returns and the next resolve crossfades like the first time. React's "adjust state
  // during render on a prop change" pattern (tracking the previous value), not an effect.
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setSkeletonMounted(true);
  }

  const morphWidth = animateSize === true || animateSize === 'width' || animateSize === 'both';
  const morphHeight = animateSize === 'height' || animateSize === 'both';

  const wrapperRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const skeletonWidthRef = useRef(0);
  const skeletonHeightRef = useRef(0);

  // Remember the skeleton's rendered size while it's in flow, so we can morph FROM it on reveal.
  useLayoutEffect(() => {
    if ((!morphWidth && !morphHeight) || !loading) return;
    const el = wrapperRef.current;
    /* v8 ignore next -- the wrapper is always mounted while loading */
    if (!el) return;
    skeletonWidthRef.current = el.offsetWidth;
    skeletonHeightRef.current = el.offsetHeight;
  });

  // The reveal. Crossfade the content in + the skeleton out together (GSAP, so they're guaranteed
  // concurrent and jank-free), optionally morphing the width alongside. Uses a plain layout effect
  // with `kill` (not GSAP's context-revert) so completing the fade doesn't snap the content back to
  // opacity 0. A warm cache (skeletonMounted already false) reveals with nothing to animate.
  useLayoutEffect(() => {
    if (loading || !skeletonMounted) return;
    const content = contentRef.current;
    const overlay = overlayRef.current;
    const wrapper = wrapperRef.current;
    /* v8 ignore next -- all three layers are mounted whenever a reveal runs */
    if (!content || !overlay || !wrapper) return;

    const seconds = prefersReducedMotion() ? 0 : durationMs / 1000;
    const ease = 'power2.inOut';
    const tweens = [
      gsap.fromTo(content, { opacity: 0 }, { opacity: 1, duration: seconds, ease }),
      gsap.fromTo(
        overlay,
        { opacity: 1 },
        { opacity: 0, duration: seconds, ease, onComplete: () => setSkeletonMounted(false) },
      ),
    ];

    // Morph the size alongside the fade (same duration + ease) so the box resizes AS the content
    // appears — one concurrent motion, not resize-then-pop.
    if (seconds > 0) {
      const morphAxis = (property: 'width' | 'height', from: number, to: number): void => {
        if (from === to) return;
        tweens.push(
          gsap.fromTo(
            wrapper,
            { [property]: from },
            {
              [property]: to,
              duration: seconds,
              ease,
              onStart: () => {
                wrapper.style.overflow = 'hidden';
              },
              onComplete: () => {
                wrapper.style[property] = '';
                wrapper.style.overflow = '';
              },
            },
          ),
        );
      };
      if (morphWidth) morphAxis('width', skeletonWidthRef.current, wrapper.offsetWidth);
      if (morphHeight) morphAxis('height', skeletonHeightRef.current, wrapper.offsetHeight);
    }

    return () => tweens.forEach((tween) => tween.kill());
  }, [loading, skeletonMounted, morphWidth, morphHeight, durationMs]);

  return (
    <span ref={wrapperRef} className={twMerge('relative', className)}>
      {loading ? (
        <span className={contentClassName}>{skeleton}</span>
      ) : (
        <>
          <span ref={contentRef} className={contentClassName}>
            {children}
          </span>
          {skeletonMounted && (
            <span ref={overlayRef} aria-hidden className={twMerge(contentClassName, 'absolute inset-0')}>
              {skeleton}
            </span>
          )}
        </>
      )}
    </span>
  );
};

export default SkeletonFade;
