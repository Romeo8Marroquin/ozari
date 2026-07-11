import gsap from 'gsap';
import { PAGE_ENTER, PAGE_ENTER_STAGGER, PAGE_EXIT, PAGE_EXIT_STAGGER, prefersReducedMotion } from '@utils/motion';

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
