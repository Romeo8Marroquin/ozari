import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { PAGE_ENTER, PAGE_ENTER_STAGGER, PAGE_EXIT, PAGE_EXIT_STAGGER, prefersReducedMotion } from '@utils/motion';

gsap.registerPlugin(Flip);

/**
 * The panel's SHARED page-motion vocabulary — pure GSAP, no business logic. Kept in one module
 * (and coverage-excluded, like `useAuthCard`) because these are visual timelines verified by eye,
 * not by assertions: every function snaps / instant-resolves under reduced motion, and the pages'
 * STATE logic (which view to show, when to hand off a skeleton) lives in the pages and IS tested.
 *
 * Every page transition is INTERRUPTIBLE, and these helpers are what make that safe:
 *   - Never `gsap.from`. Enters are `fromTo` (canonical mounts) or `to` (resuming a cancelled
 *     exit) — a `.from` reverting to its recorded "natural" state is how the old one-frame flash of
 *     the outgoing page happened.
 *   - Every tween sets `overwrite: true`, so creating a tween KILLS any tween already driving the
 *     same targets. A retarget therefore always continues from the current rendered frame — this is
 *     the single mechanism behind "cut the animation and drive to the new target".
 *   - Promise-returning helpers resolve on BOTH `onComplete` and `onInterrupt`, so an overwritten
 *     exit never leaves a dangling promise (the layout guards staleness with a run token).
 *   - The anti-flash invariant: an exit's final state (`autoAlpha: 0`) persists untouched until
 *     React unmounts the page — nothing here reverts or clears opacity after an exit resolves.
 *
 * Staggers use a fixed BUDGET (`stagger: { amount }`), so a transition's total time is constant no
 * matter how many elements a page renders (see `@utils/motion`).
 */

export interface EnterOptions {
  /** Resume from wherever the elements currently are (a cancelled exit) instead of the canonical
   *  off-screen start — the motion continues from the current frame, it never snaps back. */
  fromCurrent?: boolean;
}

/**
 * Distribute a stagger BUDGET across the items as a row/column WAVE instead of one long DOM-order
 * line. Items inside a CSS grid get a 2D position (their row dominates the delay; the column adds a
 * smaller ripple within the row), so a dense product grid cascades diagonally from the top-left;
 * items outside any grid (a header row, stacked sections) each take their own "row" in DOM order.
 * Delays are normalized to the budget, so the TOTAL spread stays constant regardless of item count
 * — 4 cards or 24, the last item starts `budget` seconds after the first.
 */
function waveDelays(items: HTMLElement[], budget: number): number[] {
  const COLUMN_RIPPLE = 0.35; // how much of a row-step a column-step is worth
  let nextRow = 0;
  const gridInfo = new Map<HTMLElement, { cols: number; baseRow: number; count: number }>();

  const distances = items.map((item) => {
    const parent = item.parentElement;
    if (!parent || getComputedStyle(parent).display !== 'grid') {
      return nextRow++;
    }
    let info = gridInfo.get(parent);
    if (!info) {
      const cols = getComputedStyle(parent).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      info = { cols, baseRow: nextRow, count: 0 };
      gridInfo.set(parent, info);
    }
    const row = info.baseRow + Math.floor(info.count / info.cols);
    const col = info.count % info.cols;
    info.count += 1;
    nextRow = Math.max(nextRow, row + 1);
    return row + col * COLUMN_RIPPLE;
  });

  const max = Math.max(...distances);
  return distances.map((d) => (max > 0 ? (d / max) * budget : 0));
}

/** Staggered entrance for a page's marked items — a gentle fade + rise + faint settle, cascading
 *  as a row/column wave (see {@link waveDelays}). */
export function staggerIn(scope: HTMLElement | null, selector: string, options?: EnterOptions): void {
  if (!scope) return;
  const items = gsap.utils.selector(scope)(selector) as HTMLElement[];
  if (items.length === 0) return;
  if (prefersReducedMotion()) {
    gsap.set(items, { autoAlpha: 1, y: 0, scale: 1, clearProps: 'transform' });
    return;
  }
  const delays = waveDelays(items, PAGE_ENTER_STAGGER);
  const to = {
    y: 0,
    autoAlpha: 1,
    scale: 1,
    duration: PAGE_ENTER.duration,
    ease: PAGE_ENTER.ease,
    stagger: (index: number) => delays[index],
    overwrite: true as const,
    clearProps: 'transform',
  };
  if (options?.fromCurrent) {
    gsap.to(items, to);
    return;
  }
  gsap.fromTo(items, { y: 16, autoAlpha: 0, scale: 0.98 }, to);
}

/** Staggered exit — every marked item lifts and fades, quick and accelerating, the same wave
 *  direction as the entrance (top-left leaves first) on a tighter budget. */
export function staggerOut(scope: HTMLElement | null, selector: string): Promise<void> {
  return new Promise((resolve) => {
    if (!scope) {
      resolve();
      return;
    }
    const items = gsap.utils.selector(scope)(selector) as HTMLElement[];
    if (items.length === 0 || prefersReducedMotion()) {
      resolve();
      return;
    }
    const delays = waveDelays(items, PAGE_EXIT_STAGGER);
    gsap.to(items, {
      y: -12,
      autoAlpha: 0,
      scale: 0.98,
      duration: PAGE_EXIT.duration,
      ease: PAGE_EXIT.ease,
      stagger: (index: number) => delays[index],
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

/** Default whole-screen enter — the baseline for pages that don't register their own motion. */
export function fadeIn(element: HTMLElement, options?: EnterOptions): void {
  if (prefersReducedMotion()) {
    gsap.set(element, { autoAlpha: 1, y: 0 });
    return;
  }
  const to = { autoAlpha: 1, y: 0, duration: PAGE_ENTER.duration, ease: PAGE_ENTER.ease, overwrite: true as const };
  if (options?.fromCurrent) {
    gsap.to(element, to);
    return;
  }
  gsap.fromTo(element, { autoAlpha: 0, y: 16 }, to);
}

/** Default whole-screen exit — the baseline fade + lift. */
export function fadeOut(element: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(element, {
      autoAlpha: 0,
      y: -16,
      duration: PAGE_EXIT.duration,
      ease: PAGE_EXIT.ease,
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

// ── The per-card skeleton→content reveal ─────────────────────────────────────────────────────────

/** Cascade step between sibling cards' reveals (section N starts N steps after section 0). */
export const SECTION_REVEAL_STEP = 0.08;
/** Stagger budget distributed across one card's `.reveal-item` fields (same wave as pages). */
const SECTION_ITEM_STAGGER = 0.2;
/** How long the shimmer dissolve + height morph take (they run in lock-step). */
const SECTION_REVEAL = { duration: 0.5, ease: 'power2.inOut' } as const;

export interface SectionRevealOptions {
  /** The skeleton's rendered height, measured while it was in flow — the morph's FROM. */
  skeletonHeight: number;
  /** This card's slot in the cascade (multiples of {@link SECTION_REVEAL_STEP}). */
  delaySeconds: number;
  /** Fired once the whole reveal settles — the caller drops the skeleton overlay. */
  onSettled: () => void;
  /** What cascades inside the content — `.reveal-item` fields by default; a PAGE-level reveal
   *  (product detail/edit) passes `.reveal-block` so whole section cards ride the wave instead. */
  itemSelector?: string;
}

/**
 * The "integrated" skeleton→content swap for ONE section card: the shimmer overlay dissolves while
 * the card's height eases from the skeleton's to the content's natural height (one object
 * transforming — the pill doctrine, vertically), and the real fields cascade into place beneath it
 * with the same row/column wave as page entrances. One timeline so the three motions can never
 * mis-time; returns a cleanup that kills it. `immediateRender` pins every from-state during the
 * cascade delay (no flash of finished content before this card's turn).
 */
export function revealSectionContent(
  wrapper: HTMLElement,
  content: HTMLElement,
  overlay: HTMLElement,
  { skeletonHeight, delaySeconds, onSettled, itemSelector = '.reveal-item' }: SectionRevealOptions,
): () => void {
  if (prefersReducedMotion()) {
    onSettled();
    return () => undefined;
  }

  const targetHeight = wrapper.offsetHeight;
  const morphHeight = skeletonHeight !== targetHeight;
  if (morphHeight) wrapper.style.overflow = 'hidden';

  const timeline = gsap.timeline({
    delay: delaySeconds,
    onComplete: () => {
      wrapper.style.height = '';
      wrapper.style.overflow = '';
      onSettled();
    },
  });
  timeline.fromTo(
    overlay,
    { autoAlpha: 1 },
    { autoAlpha: 0, duration: SECTION_REVEAL.duration, ease: SECTION_REVEAL.ease, immediateRender: true },
    0,
  );
  if (morphHeight) {
    timeline.fromTo(
      wrapper,
      { height: skeletonHeight },
      { height: targetHeight, duration: SECTION_REVEAL.duration, ease: SECTION_REVEAL.ease, immediateRender: true },
      0,
    );
  }

  const items = gsap.utils.selector(content)(itemSelector) as HTMLElement[];
  if (items.length > 0) {
    const delays = waveDelays(items, SECTION_ITEM_STAGGER);
    timeline.fromTo(
      items,
      { y: 10, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: PAGE_ENTER.duration,
        ease: PAGE_ENTER.ease,
        stagger: (index: number) => delays[index],
        immediateRender: true,
        clearProps: 'transform',
      },
      0.08,
    );
  }

  return () => {
    timeline.kill();
  };
}

// ── Dynamic list rows (the details sub-editor) ──────────────────────────────────────────────────

/** The column gap (`gap-5` = 1.25rem) a leaving/entering row must also open/close. */
const ROW_GAP_PX = 20;

/** A freshly-added row grows its space open while sliding in from the left (it's a list). */
export function detailRowIn(row: HTMLElement | null): void {
  if (!row || prefersReducedMotion()) return;
  gsap.fromTo(
    row,
    { height: 0, marginBottom: -ROW_GAP_PX, x: -20, autoAlpha: 0, overflow: 'hidden' },
    {
      height: 'auto',
      marginBottom: 0,
      x: 0,
      autoAlpha: 1,
      duration: 0.35,
      ease: PAGE_ENTER.ease,
      overwrite: true,
      clearProps: 'height,marginBottom,overflow,transform',
    },
  );
}

/** A removed row slides out to the right while its space eases closed; resolves when done. */
export function detailRowOut(row: HTMLElement | null): Promise<void> {
  if (!row || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const timeline = gsap.timeline({ onComplete: resolve, onInterrupt: resolve });
    timeline.set(row, { overflow: 'hidden' });
    timeline.to(row, { x: 24, autoAlpha: 0, duration: 0.2, ease: PAGE_EXIT.ease, overwrite: true }, 0);
    // The space closes as the row fades — `-marginBottom` also swallows the flex gap it owned.
    timeline.to(
      row,
      { height: 0, marginBottom: -ROW_GAP_PX, duration: 0.3, ease: 'power3.out' },
      0.08,
    );
  });
}

// ── The photo gallery grid (add / remove reflow) ────────────────────────────────────────────────

/**
 * Snapshot the gallery's `.gallery-flip` boxes (tiles + the mounted picker) BEFORE a mutation —
 * hand it to {@link animateGalleryLayout}. The two pickers (empty-state dropzone, in-grid add
 * tile) share a `data-flip-id`, so a capture on one side can morph into the other. `selector`
 * generalizes the same capture to any FLIP-choreographed list (the product grid's card wrappers).
 */
export function captureGalleryLayout(
  scope: HTMLElement | null,
  selector = '.gallery-flip',
): Flip.FlipState | null {
  if (!scope || prefersReducedMotion()) return null;
  return Flip.getState(scope.querySelectorAll(selector));
}

/**
 * A refetch-driven LIST DIFF, phase 2 (see `useGridListTransition`): after the new list commits,
 * SURVIVING cards (matched across different DOM nodes by `data-flip-id` — the grid's slots are
 * index-keyed, so a product's wrapper changes node between renders) GLIDE from their captured
 * boxes to their new cells, while cards that just APPEARED (an id absent from the captured state)
 * fade-rise in. Removed cards were already tweened out in phase 1. Reduced motion / no capture →
 * instant, like every FLIP here.
 */
export function animateListReflow(
  scope: HTMLElement | null,
  selector: string,
  state: Flip.FlipState | null,
): void {
  if (!scope || !state || prefersReducedMotion()) return;
  const targets = scope.querySelectorAll(selector);
  // The grid's slots are INDEX-keyed, so React REUSES the wrapper node that hosted a removed card
  // for whichever survivor takes its slot — phase 1's leftovers (opacity 0, scale .9) would leave
  // that survivor invisible. Sanitize every target before the glide; the FLIP + onEnter own all
  // motion from here.
  gsap.killTweensOf(targets);
  gsap.set(targets, { clearProps: 'opacity,visibility,transform' });
  Flip.from(state, {
    targets,
    duration: 0.4,
    ease: 'power3.out',
    overwrite: true,
    onEnter: (elements) =>
      gsap.fromTo(
        elements,
        { autoAlpha: 0, y: 12, scale: 0.96 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.4,
          ease: PAGE_ENTER.ease,
          overwrite: true,
          clearProps: 'transform',
        },
      ),
  });
}

/**
 * A refetch-driven LIST DIFF, phase 1: the cards about to LEAVE shrink and fade in place (the
 * gallery-removal language) BEFORE the new list commits — so a deletion never just blinks out.
 * Resolves when they're gone (immediately under reduced motion / with nothing to remove).
 */
export function animateTilesOut(els: HTMLElement[]): Promise<void> {
  if (els.length === 0 || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(els, {
      scale: 0.9,
      autoAlpha: 0,
      duration: 0.25,
      ease: PAGE_EXIT.ease,
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

/** The subtle, professional pop for photos joining the grid — a hint of overshoot, not a cartoon. */
const bounceThumbsIn = (targets: gsap.TweenTarget): void => {
  gsap.fromTo(
    targets,
    { scale: 0.85, autoAlpha: 0 },
    {
      scale: 1,
      autoAlpha: 1,
      duration: 0.45,
      ease: 'back.out(1.4)',
      stagger: 0.05,
      overwrite: true,
      clearProps: 'transform',
    },
  );
};

/**
 * FLIP the gallery grid after an IN-GRID mutation: surviving tiles GLIDE from the captured layout
 * to their new cells (the "space" opens/closes smoothly instead of snapping) and brand-new tiles
 * bounce in softly. In-flow FLIP only (never absolute — pulling tiles out of flow collapses the
 * card under them). With no captured state (reduced motion returned null) only the entrance plays.
 * Removals are two-phase: the thumb tweens OUT first ({@link animateThumbOut}), then this reflows
 * the survivors. The empty ↔ grid boundary is a DIFFERENT move — {@link animateGalleryBoundary}.
 */
export function animateGalleryLayout(
  scope: HTMLElement | null,
  state: Flip.FlipState | null,
): void {
  if (!scope || prefersReducedMotion()) return;
  const targets = scope.querySelectorAll('.gallery-flip');
  if (!state) {
    bounceThumbsIn(targets);
    return;
  }
  Flip.from(state, {
    targets,
    duration: 0.4,
    ease: 'power3.out',
    onEnter: (elements) => bounceThumbsIn(elements),
  });
}

/**
 * The empty-dropzone ⇄ grid transition: the swap container's HEIGHT eases from the old view's to
 * the new one's (so the card and everything below reflow smoothly — the space is the animation)
 * while the incoming view settles in: grid → the tiles bounce; dropzone → it fades/scales into
 * place. (A true cross-container FLIP morph was tried and rejected: absolute-positioning the
 * tiles pulls them out of flow, collapsing the card and floating them over the next section.)
 */
export function animateGalleryBoundary(container: HTMLElement | null, fromHeight: number): void {
  if (!container || prefersReducedMotion()) return;
  const toHeight = container.offsetHeight;
  if (fromHeight > 0 && fromHeight !== toHeight) {
    gsap.fromTo(
      container,
      { height: fromHeight, overflow: 'hidden' },
      {
        height: toHeight,
        duration: 0.45,
        ease: 'power3.out',
        overwrite: true,
        clearProps: 'height,overflow',
      },
    );
  }
  const list = container.querySelector('ul');
  if (list) {
    bounceThumbsIn(list.children);
    return;
  }
  const dropzone = container.firstElementChild;
  if (dropzone) {
    gsap.fromTo(
      dropzone,
      { autoAlpha: 0, scale: 0.97 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.4,
        ease: PAGE_ENTER.ease,
        overwrite: true,
        clearProps: 'transform',
      },
    );
  }
}

/**
 * FLIP the grid after a mid-DRAG reorder: every tile EXCEPT the dragged one glides from the
 * captured layout to its new cell (the dragged tile is pinned under the pointer — the drag hook
 * repositions it itself). Reduced motion (or no captured state) just snaps, like the other FLIPs.
 */
export function animateGalleryReorder(
  scope: HTMLElement | null,
  state: Flip.FlipState | null,
  dragged: HTMLElement | null,
): void {
  if (!scope || !state || prefersReducedMotion()) return;
  const targets = [...scope.querySelectorAll('.gallery-flip')].filter((el) => el !== dragged);
  // `overwrite: true` = the interruptibility rule: a second reorder landing mid-glide kills the
  // first glide's tweens and continues from the current frame — never two transforms fighting.
  Flip.from(state, { targets, duration: 0.3, ease: 'power3.out', overwrite: true });
}

/**
 * A tile's RESTING box: its live rect minus any in-flight x/y transform (a FLIP glide, the drag
 * pin). The reorder hit test MUST use this, never the live rect — mid-glide a displaced tile still
 * covers its OLD cell, so testing live rects re-triggers the swap it is animating away from and the
 * order thrashes back and forth every pointermove (the "teleporting" bug).
 */
export function getTileRestingRect(el: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const rect = el.getBoundingClientRect();
  const x = Number(gsap.getProperty(el, 'x')) || 0;
  const y = Number(gsap.getProperty(el, 'y')) || 0;
  return { left: rect.left - x, top: rect.top - y, right: rect.right - x, bottom: rect.bottom - y };
}

/** The picked-up tile rises above its siblings and swells slightly — "I'm in your hand" feedback. */
export function galleryDragLift(el: HTMLElement | null): void {
  if (!el) return;
  gsap.set(el, { zIndex: 40 });
  if (prefersReducedMotion()) return;
  gsap.to(el, { scale: 1.05, duration: 0.15, ease: 'power2.out', overwrite: true });
}

/** Pin the dragged tile under the pointer. A raw `set` on purpose — tracking is interaction, not
 *  decoration, so it runs identically under reduced motion. */
export function galleryDragMove(el: HTMLElement | null, x: number, y: number): void {
  if (!el) return;
  gsap.set(el, { x, y });
}

/** The released tile settles back into its (possibly new) cell; resolves when it lands. */
export function galleryDragSettle(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  if (prefersReducedMotion()) {
    gsap.set(el, { x: 0, y: 0, scale: 1, clearProps: 'transform,zIndex' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    gsap.to(el, {
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.3,
      ease: 'power3.out',
      overwrite: true,
      clearProps: 'transform,zIndex',
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

/** A removed photo shrinks and fades in place; resolves so the caller can then commit + reflow. */
export function animateThumbOut(el: HTMLElement | null): Promise<void> {
  if (!el || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(el, {
      scale: 0.8,
      autoAlpha: 0,
      duration: 0.2,
      ease: PAGE_EXIT.ease,
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

// The header section title rides the SAME two-phase flow as the content body, so it never just
// "swaps": it slides out to the left as we leave (in step with the content exit), then the new
// title slides in from the right with the content entrance. Targeted by class (like the layout's
// mount timeline) so `PanelLayout` can drive the header without a ref into it.
const HEADER_TITLE = '.panel-header-title';

export function headerTitleOut(): Promise<void> {
  const element = document.querySelector(HEADER_TITLE);
  if (!element || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(element, {
      autoAlpha: 0,
      x: -14,
      duration: PAGE_EXIT.duration,
      ease: PAGE_EXIT.ease,
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

export function headerTitleIn(options?: EnterOptions): void {
  const element = document.querySelector(HEADER_TITLE);
  if (!element) return;
  if (prefersReducedMotion()) {
    gsap.set(element, { autoAlpha: 1, x: 0 });
    return;
  }
  const to = { autoAlpha: 1, x: 0, duration: PAGE_ENTER.duration, ease: PAGE_ENTER.ease, overwrite: true as const };
  if (options?.fromCurrent) {
    gsap.to(element, to);
    return;
  }
  gsap.fromTo(element, { autoAlpha: 0, x: 14 }, to);
}
