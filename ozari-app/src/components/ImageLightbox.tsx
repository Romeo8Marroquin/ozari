import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiChevronLeft, HiChevronRight, HiOutlineXMark } from 'react-icons/hi2';
import { registerModal } from './modalRegistry';
import { prefersReducedMotion } from '@utils/motion';
import { fitImageBox } from '@utils/lightboxLayout';

const KEY = 'components.lightbox';

/** Viewport fraction the image frame may occupy (the rest is the breathing margin). */
const MAX_WIDTH_FRACTION = 0.92;
const MAX_HEIGHT_FRACTION = 0.86;
/** Swipe distance (px) that counts as a page turn on touch/drag. */
const SWIPE_THRESHOLD_PX = 40;

interface ImageLightboxProps {
  /** The photos of ONE set. Anything with a `url` qualifies — a product's gallery, an order step's
   *  evidence — because the viewer only ever renders and pages through urls. */
  images: { url: string }[];
  /** Which image opens first (whatever the opener was showing). */
  initialIndex: number;
  /** Names the dialog and every photo in it: the product's name, the lifecycle step, … */
  label: string;
  /** Called once the exit animation settles — the parent unmounts then. */
  onClose: () => void;
}

/**
 * The full-size image viewer: a dismissible overlay (Escape / backdrop / ✕, per the Modal
 * doctrine, incl. `registerModal` so logout teardown sweeps it) whose FRAME adapts to each
 * image — as large as the viewport allows within margins, aspect-true (`object-contain`, never a
 * crop), centered both ways. Built for the catalog's portrait 4:3 photos but any ratio renders
 * gracefully: switching images fades the current one out (center-origin, slight shrink), EASES the
 * frame to the next image's fitted size, then fades the new one in — quick, smooth, electric.
 *
 * **It shows exactly the set it was given.** The caller decides what belongs together — a product's
 * gallery, or the photos of ONE lifecycle step — so paging can never wander from a delivery's
 * evidence into a collection's.
 *
 * Navigation is FINITE (no wrap): edge arrows disable at the ends. Arrows, ← → keys, and
 * touch/drag swipe all page; a terse "X de Y" chip tracks the position. Focus is trapped among
 * the controls and restored to the opener on close; background scroll is locked.
 */
const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  initialIndex,
  label,
  onClose,
}) => {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  // The live index for the document-level key handler (registered once on mount — reading the
  // state directly there would freeze it at the first render's value).
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  });
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const swipeStartX = useRef<number | null>(null);
  /** Live touch count on the frame — a second finger turns the gesture into a pinch, not a swipe. */
  const activePointers = useRef(0);

  /* v8 ignore next -- defensive `??`: `step` clamps the index inside the array */
  const current = images[index] ?? images[0];
  const count = images.length;

  /** Play the exit (fade + slight shrink), then hand control back to the parent. */
  const close = (): void => {
    if (closingRef.current) return;
    closingRef.current = true;
    const seconds = prefersReducedMotion() ? 0 : 0.18;
    gsap.to(container.current, { autoAlpha: 0, duration: seconds, ease: 'power2.in' });
    gsap.to(frame.current, {
      scale: 0.96,
      duration: seconds,
      ease: 'power2.in',
      onComplete: onClose,
    });
  };

  /** Finite paging: fade the image out while the FRAME (it owns the corner radius) breathes in a
   *  touch — scaling the image alone pulled its square corners inside the rounded clip. */
  const step = (delta: number): void => {
    const next = indexRef.current + delta;
    if (next < 0 || next >= count) return;
    const seconds = prefersReducedMotion() ? 0 : 0.14;
    gsap.to(frame.current, {
      scale: 0.97,
      transformOrigin: 'center center',
      duration: seconds,
      ease: 'power2.in',
      overwrite: true,
    });
    gsap.to(image.current, {
      autoAlpha: 0,
      duration: seconds,
      ease: 'power2.in',
      overwrite: true,
      onComplete: () => setIndex(next),
    });
  };

  /** Each image announces its natural size on load: ease the frame to its fitted box, fade it in. */
  const handleImageLoad = (): void => {
    const imageElement = image.current;
    const frameElement = frame.current;
    /* v8 ignore next -- both are mounted whenever an image can load */
    if (!imageElement || !frameElement) return;
    const box = fitImageBox(
      imageElement.naturalWidth,
      imageElement.naturalHeight,
      window.innerWidth * MAX_WIDTH_FRACTION,
      window.innerHeight * MAX_HEIGHT_FRACTION,
    );
    const seconds = prefersReducedMotion() ? 0 : 0.25;
    gsap.to(frameElement, {
      width: box.width,
      height: box.height,
      scale: 1, // settle back from the step's breath — the frame carries ALL the scaling
      duration: seconds,
      ease: 'power3.out',
      overwrite: true,
    });
    gsap.fromTo(
      imageElement,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: seconds, ease: 'power2.out', overwrite: true },
    );
  };

  // Mount lifecycle: entrance fade, scroll lock, focus in (and back out on unmount), teardown
  // registration, and the keyboard surface (Escape / arrows / a minimal Tab trap over the few
  // controls this dialog has).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const unregister = registerModal(close);

    gsap.fromTo(
      container.current,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: prefersReducedMotion() ? 0 : 0.2, ease: 'power2.out' },
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'Tab') {
        const focusables = Array.from(
          /* v8 ignore next -- defensive `??`: the container is mounted while the dialog is open */
          container.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
        );
        /* v8 ignore next -- the close button always exists */
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      unregister();
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only lifecycle; handlers read live refs/state
  }, []);

  return createPortal(
    <div
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
    >
      {/* The scrim — clicking it dismisses (the ✕ is the accessible control). */}
      <div
        aria-hidden
        data-testid="lightbox-backdrop"
        onClick={close}
        className="absolute inset-0 bg-charcoal/70 backdrop-blur-sm"
      />

      <button
        ref={closeButton}
        type="button"
        aria-label={t(`${KEY}.close`)}
        onClick={close}
        className="absolute right-4 top-4 z-[1] grid size-10 cursor-pointer place-items-center rounded-full bg-white/90 text-charcoal shadow-sm transition-[background-color,scale] duration-200 ease-[var(--ease-settle)] hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta motion-reduce:transition-none"
      >
        <HiOutlineXMark aria-hidden className="size-5" />
      </button>

      <div className="pointer-events-none relative z-[1] flex flex-col items-center gap-3">
        {/* The adaptive frame — starts at the catalog's expected portrait 4:3 fit; each image's
            load eases it to that image's own fitted box. Swipe pages on touch/drag. */}
        <div
          ref={frame}
          data-testid="lightbox-frame"
          onPointerDown={(event) => {
            // A press that starts on a CONTROL (the arrows) is a click, never a swipe. Capturing
            // it would retarget the pointerup to the frame, and the browser then synthesizes NO
            // `click` on the button — mouse clicks died while touch (whose click comes from the
            // tap pipeline, immune to pointer capture) kept working.
            if ((event.target as Element).closest('button')) return;
            // A SECOND finger means a pinch (zoom), never a swipe — abandon the gesture. The
            // browser owns the zoom itself (`touch-action` below allows it); building an in-frame
            // zoom is a separate feature, and page zoom is the native, expected behaviour.
            activePointers.current += 1;
            if (activePointers.current > 1) {
              swipeStartX.current = null;
              return;
            }
            swipeStartX.current = event.clientX;
            // Capture so the swipe still completes when the finger drifts OFF the photo onto the
            // backdrop — best-effort (some DOMs refuse for untracked pointers).
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* v8 ignore next -- capture is a progressive nicety, never load-bearing */
            }
          }}
          onPointerUp={(event) => {
            activePointers.current = Math.max(0, activePointers.current - 1);
            if (swipeStartX.current === null) return;
            const delta = event.clientX - swipeStartX.current;
            swipeStartX.current = null;
            if (delta <= -SWIPE_THRESHOLD_PX) step(1);
            else if (delta >= SWIPE_THRESHOLD_PX) step(-1);
          }}
          onPointerCancel={() => {
            activePointers.current = Math.max(0, activePointers.current - 1);
            swipeStartX.current = null;
          }}
          // `pan-y` keeps vertical scrolling native while horizontal drags reach us as pointer
          // events; `pinch-zoom` explicitly PRESERVES the two-finger zoom (the old `touch-pan-y`
          // alone was blocking it).
          className="pointer-events-auto relative overflow-hidden rounded-card bg-charcoal/40 shadow-2xl [touch-action:pan-y_pinch-zoom]"
          style={fitImageBox(3, 4, window.innerWidth * MAX_WIDTH_FRACTION, window.innerHeight * MAX_HEIGHT_FRACTION)}
        >
          {current && (
            <img
              ref={image}
              data-testid="lightbox-image"
              src={current.url}
              alt={label}
              draggable={false}
              onLoad={handleImageLoad}
              className="absolute inset-0 size-full select-none object-contain"
            />
          )}
          {count > 1 && (
            <>
              <button
                type="button"
                aria-label={t(`${KEY}.previous`)}
                disabled={index === 0}
                onClick={() => step(-1)}
                className="absolute left-2 top-1/2 z-[1] grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/85 text-charcoal shadow-sm transition-[background-color,opacity,scale] duration-200 ease-[var(--ease-settle)] hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100 motion-reduce:transition-none"
              >
                <HiChevronLeft aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                aria-label={t(`${KEY}.next`)}
                disabled={index === count - 1}
                onClick={() => step(1)}
                className="absolute right-2 top-1/2 z-[1] grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/85 text-charcoal shadow-sm transition-[background-color,opacity,scale] duration-200 ease-[var(--ease-settle)] hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100 motion-reduce:transition-none"
              >
                <HiChevronRight aria-hidden className="size-5" />
              </button>
            </>
          )}
        </div>

        {/* The terse position chip — readable, never in the way. (Sharing lives on the detail
            page: platforms share LINKS by default, so a per-photo share here added nothing.) */}
        {count > 1 && (
          <div className="pointer-events-auto flex items-center gap-2">
            <p className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-charcoal/70 shadow-sm">
              {t(`${KEY}.counter`, { current: index + 1, total: count })}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ImageLightbox;
