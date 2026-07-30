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
  /** Where a canonical entrance starts: `bottom` (the app-wide default rise) or a SIDE, reserved
   *  for genuinely LATERAL moves (the orders agenda⇄historial swap enters from the side the
   *  motion is travelling from, mirroring the segmented control's pill). Ignored with
   *  `fromCurrent` (a resume has no canonical start). */
  from?: 'bottom' | 'left' | 'right';
}

export interface ExitOptions {
  /** Where the exit heads: `top` (the app-wide default lift) or a SIDE for lateral swaps. */
  to?: 'top' | 'left' | 'right';
}

// The canonical off-screen states per direction. Both axes are always written (x AND y) so an
// interrupted lateral tween can never strand a vertical offset, and vice versa.
const ENTER_FROM = {
  bottom: { x: 0, y: 16 },
  left: { x: -20, y: 0 },
  right: { x: 20, y: 0 },
} as const;
const EXIT_TO = {
  top: { x: 0, y: -12 },
  left: { x: -16, y: 0 },
  right: { x: 16, y: 0 },
} as const;

/**
 * The scale a directional move starts (or ends) at: 0.98 for the vertical default, **none** for a
 * lateral one.
 *
 * Scale is a DEPTH cue, and its visible magnitude is proportional to the element's size: 2% of an 80px
 * agenda row is 1.6px of edge travel (imperceptible), but 2% of a 320px section card is ~6px — and with
 * the default center origin that reads as the card sitting LOWER and rising as it settles. On a screen
 * whose axis is left/right that contradicts the very motion it was decorating, so a lateral move is
 * pure slide + fade.
 */
const SCALE_FOR = { bottom: 0.98, top: 0.98, left: 1, right: 1 } as const;

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

/**
 * Per-cell reveal delay for a RESOLVING grid's skeleton→content crossfades (`SkeletonFade`'s
 * `revealDelaySeconds`). Every slot flips in the same React commit, so each cell must derive its
 * own slot in the wave from the rendered layout: climb from `el` (the SkeletonFade wrapper) to the
 * direct grid item, then apply the same row-dominant/column-ripple geometry as {@link waveDelays},
 * normalized over the WHOLE grid so the full cascade spends exactly the page-entrance budget —
 * rows first, each row rippling across its columns, regardless of how many cells resolved.
 */
export function gridCellRevealDelay(el: HTMLElement): number {
  const COLUMN_RIPPLE = 0.35;
  let cell: HTMLElement | null = el;
  while (cell && !(cell.parentElement && getComputedStyle(cell.parentElement).display === 'grid')) {
    cell = cell.parentElement;
  }
  const parent = cell?.parentElement;
  if (!cell || !parent) return 0; // not inside a grid (defensive) — reveal immediately
  const cols = getComputedStyle(parent).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const children = Array.from(parent.children);
  const index = children.indexOf(cell);
  const distance = Math.floor(index / cols) + (index % cols) * COLUMN_RIPPLE;
  const rows = Math.ceil(children.length / cols);
  const max = rows - 1 + Math.min(cols - 1, children.length - 1) * COLUMN_RIPPLE;
  return max > 0 ? (distance / max) * PAGE_ENTER_STAGGER : 0;
}

/**
 * Row-list analogue of {@link gridCellRevealDelay}: the orders agenda is a single COLUMN of rows
 * (not a CSS grid), so a resolving row derives its wave slot from its position among the list's
 * direct children — day/owner header rows included, so the skeleton→content cascade reads strictly
 * top-to-bottom over the page-entrance budget. Climbs from the `SkeletonFade` wrapper to the direct
 * child of the `[data-order-rows]` list container.
 */
export function rowRevealDelay(el: HTMLElement): number {
  let row: HTMLElement | null = el;
  while (row && !row.parentElement?.hasAttribute('data-order-rows')) {
    row = row.parentElement;
  }
  const parent = row?.parentElement;
  if (!row || !parent) return 0; // not inside the list (defensive) — reveal immediately
  const children = Array.from(parent.children);
  const index = children.indexOf(row);
  const max = children.length - 1;
  return max > 0 ? (index / max) * PAGE_ENTER_STAGGER : 0;
}

/**
 * Grow the marked rows IN — from zero height + faded to their natural height — so an element that
 * APPEARS when a cold load resolves (a new day/owner header, the total-count line, a surplus ticket)
 * eases the rows below it DOWN smoothly instead of snapping their space open. Run in a LAYOUT effect
 * so the zero-height start is pinned before the browser paints (no full-height flash). Wave-staggered
 * top-to-bottom; instant under reduced motion. Requires a GAP-LESS column (each row spaces itself via
 * its own padding) so a zero-height row genuinely occupies no space.
 */
export function growRowsIn(scope: HTMLElement | null, selector: string): void {
  if (!scope) return;
  const items = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  if (!items.length || prefersReducedMotion()) return; // mounts visible at natural height already
  const delays = waveDelays(items, PAGE_ENTER_STAGGER);
  items.forEach((el, index) => {
    gsap.set(el, { height: 'auto' });
    const naturalHeight = el.offsetHeight;
    // Two phases so there is NO clip-reveal "wipe": (1) open the height while the content stays
    // INVISIBLE — the space eases in (pushing the rows below down) with nothing to reveal, so the
    // growth is unseen — then (2) once it's (near) full size, the content FADES in un-clipped. The
    // height and fade never overlap enough to clip visible content.
    gsap.set(el, { autoAlpha: 0, overflow: 'hidden' });
    const timeline = gsap.timeline({ delay: delays[index] });
    timeline.fromTo(
      el,
      { height: 0 },
      {
        height: naturalHeight,
        duration: PAGE_ENTER.duration,
        ease: PAGE_ENTER.ease,
        onComplete: () => {
          el.style.height = '';
          el.style.overflow = '';
        },
      },
    );
    timeline.to(el, { autoAlpha: 1, duration: PAGE_ENTER.duration * 0.6, ease: 'power2.out' }, '>-0.05');
  });
}

/**
 * Sweep the marked rows OUT in TWO phases so a leftover cold-load skeleton row genuinely ANIMATES
 * AWAY, never "collapses" upward into the loaded rows: (1) it slides `to` the given side + fades — the
 * visible exit — then (2) once it's already gone, its space eases shut (height → 0) underneath, so the
 * content below reclaims the room smoothly with no jump and no visible shrink-in-place. Resolves when
 * the last row finishes (the caller drops the skeleton state then); resolves immediately with nothing
 * to do or under reduced motion. The exit twin of {@link growRowsIn} — same gap-less-column
 * requirement (the height half only reads smoothly when the row spaces itself with its own padding).
 */
export function collapseRowsOut(
  scope: HTMLElement | null,
  selector: string,
  to: 'left' | 'right' = 'right',
): Promise<void> {
  const items = scope ? Array.from(scope.querySelectorAll<HTMLElement>(selector)) : [];
  if (!items.length) return Promise.resolve();
  if (prefersReducedMotion()) {
    gsap.set(items, { height: 0, autoAlpha: 0, overflow: 'hidden' });
    return Promise.resolve();
  }
  const x = to === 'right' ? 44 : -44;
  const delays = waveDelays(items, PAGE_EXIT_STAGGER);
  return new Promise((resolve) => {
    let remaining = items.length;
    const settle = (): void => {
      remaining -= 1;
      if (remaining === 0) resolve();
    };
    items.forEach((el, index) => {
      gsap.set(el, { overflow: 'hidden' });
      const timeline = gsap.timeline({ delay: delays[index] });
      // 1) The row SLIDES out to the side + fades — a clean, VISIBLE "animate out".
      timeline.to(el, {
        x,
        autoAlpha: 0,
        duration: PAGE_EXIT.duration,
        ease: PAGE_EXIT.ease,
        overwrite: 'auto',
      });
      // 2) Only AFTER it's mostly gone does its (now invisible) space ease shut — so the eye sees the
      //    row LEAVE, never shrink in place, and nothing below it jumps as the space is reclaimed.
      timeline.to(
        el,
        { height: 0, duration: 0.28, ease: 'power2.inOut', onComplete: settle, onInterrupt: settle },
        PAGE_EXIT.duration * 0.55,
      );
    });
  });
}

/**
 * A GENTLE in-place fade with only a few px of rise — for a settled element that just needs to appear
 * at its final position without a wipe or a big travel (the agenda's total-count line once the
 * skeleton resolves; a full page-entrance rise would read as "coming from too far below"). Instant
 * under reduced motion.
 */
export function fadeUpIn(scope: HTMLElement | null, selector: string): void {
  if (!scope) return;
  const items = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  if (!items.length || prefersReducedMotion()) return;
  gsap.fromTo(
    items,
    { autoAlpha: 0, y: 5 },
    {
      autoAlpha: 1,
      y: 0,
      duration: PAGE_ENTER.duration,
      ease: PAGE_ENTER.ease,
      overwrite: 'auto',
      clearProps: 'y',
    },
  );
}

/** Staggered entrance for a page's marked items — a gentle fade + settle (a rise by default, or a
 *  lateral slide via `from`), cascading as a row/column wave (see {@link waveDelays}). */
export function staggerIn(scope: HTMLElement | null, selector: string, options?: EnterOptions): void {
  if (!scope) return;
  const items = gsap.utils.selector(scope)(selector) as HTMLElement[];
  if (items.length === 0) return;
  if (prefersReducedMotion()) {
    gsap.set(items, { autoAlpha: 1, x: 0, y: 0, scale: 1, clearProps: 'transform' });
    return;
  }
  const delays = waveDelays(items, PAGE_ENTER_STAGGER);
  const to = {
    x: 0,
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
  const side = options?.from ?? 'bottom';
  gsap.fromTo(items, { ...ENTER_FROM[side], autoAlpha: 0, scale: SCALE_FOR[side] }, to);
}

/** Budget for ONE block's inner item wave, and how long after its block that wave starts. Both are
 *  small on purpose: the nested cascade is a texture inside the block's own move, not a second
 *  entrance competing with it. */
const NESTED_ITEM_STAGGER = 0.16;
const NESTED_ITEM_LEAD = 0.06;
/** The inner items travel a SHORTER distance than their block — they are already arriving with it. */
const NESTED_ITEM_TRAVEL = 12;

/**
 * A TWO-LEVEL entrance: the marked blocks cascade as a wave (exactly {@link staggerIn}), and inside
 * each block its own marked items cascade AGAIN, starting just after their block's turn.
 *
 * For a screen made of section cards that each contain a list: the card arrives as one object, and its
 * rows fill in behind it, so a section reads as "a card, filling" rather than a slab of finished
 * content sliding in. Because each block's inner wave is anchored to that block's delay, the whole
 * page still reads as ONE cascade rather than two competing ones.
 *
 * The inner items travel less than their block (they are riding it in) and never scale — a nested
 * scale on top of the block's own reads as a wobble.
 */
export function staggerInNested(
  scope: HTMLElement | null,
  blockSelector: string,
  itemSelector: string,
  options?: EnterOptions,
): void {
  if (!scope) return;
  const blocks = gsap.utils.selector(scope)(blockSelector) as HTMLElement[];
  if (blocks.length === 0) return;
  const allItems = blocks.flatMap(
    (block) => gsap.utils.selector(block)(itemSelector) as HTMLElement[],
  );
  if (prefersReducedMotion()) {
    gsap.set([...blocks, ...allItems], {
      autoAlpha: 1,
      x: 0,
      y: 0,
      scale: 1,
      clearProps: 'transform',
    });
    return;
  }

  const side = options?.from ?? 'bottom';
  const blockDelays = waveDelays(blocks, PAGE_ENTER_STAGGER);
  const axis = ENTER_FROM[side];
  const itemFrom = {
    x: Math.sign(axis.x) * NESTED_ITEM_TRAVEL,
    y: Math.sign(axis.y) * NESTED_ITEM_TRAVEL,
  };

  blocks.forEach((block, index) => {
    const blockDelay = blockDelays[index] ?? 0;
    gsap.fromTo(
      block,
      { ...axis, autoAlpha: 0, scale: SCALE_FOR[side] },
      {
        x: 0,
        y: 0,
        autoAlpha: 1,
        scale: 1,
        duration: PAGE_ENTER.duration,
        ease: PAGE_ENTER.ease,
        delay: blockDelay,
        overwrite: true,
        clearProps: 'transform',
      },
    );

    const items = gsap.utils.selector(block)(itemSelector) as HTMLElement[];
    if (items.length === 0) return;
    const itemDelays = waveDelays(items, NESTED_ITEM_STAGGER);
    gsap.fromTo(
      items,
      { ...itemFrom, autoAlpha: 0 },
      {
        x: 0,
        y: 0,
        autoAlpha: 1,
        duration: PAGE_ENTER.duration,
        ease: PAGE_ENTER.ease,
        delay: blockDelay + NESTED_ITEM_LEAD,
        stagger: (itemIndex: number) => itemDelays[itemIndex],
        overwrite: true,
        clearProps: 'transform',
      },
    );
  });
}

/** Staggered exit — every marked item fades away (a lift by default, or a lateral slide via `to`),
 *  quick and accelerating, the same wave direction as the entrance on a tighter budget. */
export function staggerOut(
  scope: HTMLElement | null,
  selector: string,
  options?: ExitOptions,
): Promise<void> {
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
    const side = options?.to ?? 'top';
    gsap.to(items, {
      ...EXIT_TO[side],
      autoAlpha: 0,
      scale: SCALE_FOR[side],
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
  /** Where the content cascade comes FROM: a small rise by default, or a SIDE on a screen whose axis
   *  is lateral (the preferences groups) — so the skeleton→content resolve travels the same way as
   *  everything else there instead of contradicting it. */
  from?: 'bottom' | 'left' | 'right';
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
  {
    skeletonHeight,
    delaySeconds,
    onSettled,
    itemSelector = '.reveal-item',
    from = 'bottom',
  }: SectionRevealOptions,
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
    // A shorter travel than a page entrance's: these items are appearing INSIDE a card that is
    // already in place, so they only need to arrive, not to enter.
    const axis = ENTER_FROM[from];
    timeline.fromTo(
      items,
      { x: Math.sign(axis.x) * 12, y: Math.sign(axis.y) * 10, autoAlpha: 0 },
      {
        x: 0,
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

/** A freshly-added row grows its space open while sliding in from the left (it's a list).
 *  `gapPx` is the column gap the row must also swallow while its height is 0 — pass **0** for a
 *  divided list whose rows space themselves with their own padding (the preferences catalogs). */
export function detailRowIn(row: HTMLElement | null | undefined, gapPx: number = ROW_GAP_PX): void {
  if (!row || prefersReducedMotion()) return;
  gsap.fromTo(
    row,
    { height: 0, marginBottom: -gapPx, x: -20, autoAlpha: 0, overflow: 'hidden' },
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

/**
 * A whole CARD joining a settled column: its space grows open (swallowing the column's gap with a
 * negative margin, so a zero-height card genuinely occupies nothing) while it rises and fades in,
 * and every card below it slides down in normal flow. For a section that APPEARS because the data
 * changed — the order detail's evidence card the first time a step is documented — where a plain
 * mount would pop a whole block into the middle of the page.
 */
export function growCardIn(el: HTMLElement | null, gapPx: number): void {
  if (!el || prefersReducedMotion()) return;
  gsap.set(el, { clearProps: 'height,marginBottom' });
  const naturalHeight = el.offsetHeight;
  gsap.fromTo(
    el,
    { height: 0, marginBottom: -gapPx, y: 8, autoAlpha: 0, overflow: 'hidden' },
    {
      height: naturalHeight,
      marginBottom: 0,
      y: 0,
      autoAlpha: 1,
      duration: PAGE_ENTER.duration,
      ease: PAGE_ENTER.ease,
      overwrite: true,
      clearProps: 'height,marginBottom,overflow,transform',
    },
  );
}

/**
 * Content taking (or leaving) a SLOT inside a morph region — the catalog card's "Agregar" button
 * becoming a form, a row swapping between its display and its fields, a confirmed deletion leaving.
 *
 * These deliberately animate **only opacity and a small lift**, never height: the surrounding region
 * is a `useMorphOnChange` area that already eases its own height in normal flow, and a second height
 * tween nested inside it would fight the first (the two would each try to own the same pixels). So the
 * region grows or shrinks, the content fades within the space it opened or vacated, and the two read
 * as one gesture. That is also why a deletion here uses THIS rather than `detailRowOut`, which closes
 * the space itself and belongs to lists that have no morph region above them.
 *
 * `editorSlotOut` resolves so a caller can commit the state change only once the outgoing content is
 * gone — otherwise the box would shrink around content that was still fully visible.
 */
export function editorSlotIn(el: HTMLElement | null | undefined): void {
  if (!el || prefersReducedMotion()) return;
  gsap.fromTo(
    el,
    { autoAlpha: 0, y: 8 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.3,
      ease: PAGE_ENTER.ease,
      overwrite: true,
      clearProps: 'transform',
    },
  );
}

export function editorSlotOut(el: HTMLElement | null | undefined): Promise<void> {
  if (!el || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(el, {
      autoAlpha: 0,
      y: -4,
      duration: 0.16,
      ease: PAGE_EXIT.ease,
      overwrite: true,
      onComplete: resolve,
      onInterrupt: resolve,
    });
  });
}

/** The panel's single scroll container — every panel page shares it, and it is NOT the document, which
 *  is why anything measuring viewport rects across a scroll has to account for it explicitly. */
export const panelScroller = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('main.panel-main');

/** The nearest ancestor that actually scrolls — the panel's `main` on a page, the dialog body inside a
 *  modal. Resolved from the element rather than hardcoded, so one helper serves both. */
function scrollerFor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Bring something that just APPEARED fully into view, in step with the growth that made room for it.
 *
 * The rule this encodes: **adding something is a request to see it.** Leaving the scroll where it was
 * is only correct when nothing was asked for — here the user clicked a control whose whole point is
 * the row or form it produces, so if that lands below the fold the view follows it down. It scrolls
 * the MINIMUM needed (never past the element's own top, so a tall form never has its first field
 * pushed off screen) and rides the entrance curve, so the growth and the follow read as one movement
 * rather than a scroll on top of an animation.
 *
 * The reverse is deliberately NOT symmetric: removing a row must not scroll. The height eases shut and
 * the browser's own clamp rides down with it, so a second motion there would compete with the first.
 */
export function revealInScroller(element: HTMLElement | null, marginPx = 24): void {
  if (!element) return;
  const scroller = scrollerFor(element);
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const below = box.bottom + marginPx - view.bottom;
  if (below <= 0) return;
  // How far we may scroll before the element's own top would leave the viewport.
  const headroom = Math.max(box.top - view.top - marginPx, 0);
  const delta = Math.min(below, headroom);
  if (delta <= 0) return;
  const to = scroller.scrollTop + delta;
  if (prefersReducedMotion()) {
    scroller.scrollTop = to;
    return;
  }
  gsap.to(scroller, {
    scrollTop: to,
    duration: PAGE_ENTER.duration,
    ease: PAGE_ENTER.ease,
    overwrite: true,
  });
}

/** Swap an inline icon with a soft vertical "blink" (the password-eye motion): collapse to a line,
 *  run `swap` at the midpoint, expand back. Instant under reduced motion. */
export function iconSwapBlink(el: HTMLElement | null, swap: () => void): void {
  if (!el || prefersReducedMotion()) {
    swap();
    return;
  }
  const timeline = gsap.timeline({ defaults: { duration: 0.18, ease: 'power1.inOut' } });
  timeline.to(el, { scaleY: 0 }).add(swap).to(el, { scaleY: 1 });
}

/** A removed row slides out to the right while its space eases closed; resolves when done.
 *  `gapPx` mirrors {@link detailRowIn} — 0 for a divided, gap-less list. */
export function detailRowOut(
  row: HTMLElement | null | undefined,
  gapPx: number = ROW_GAP_PX,
): Promise<void> {
  if (!row || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const timeline = gsap.timeline({ onComplete: resolve, onInterrupt: resolve });
    timeline.set(row, { overflow: 'hidden' });
    timeline.to(row, { x: 24, autoAlpha: 0, duration: 0.2, ease: PAGE_EXIT.ease, overwrite: true }, 0);
    // The space closes as the row fades — `-marginBottom` also swallows the flex gap it owned.
    timeline.to(row, { height: 0, marginBottom: -gapPx, duration: 0.3, ease: 'power3.out' }, 0.08);
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

/**
 * Eases a container from a PREVIOUSLY MEASURED height to whatever it is now — the "the space is the
 * animation" move, without the gallery boundary's tile bounce. Pair it with a Flip reflow when a
 * list inside grows/shrinks (a thumb strip gaining its first row, a section revealing a field): the
 * tiles glide, and everything below them eases down instead of jumping. No-ops when the height
 * didn't actually change, so it's safe to call on every mutation.
 */
export function animateHeightFrom(
  container: HTMLElement | null,
  fromHeight: number,
): void {
  if (!container || prefersReducedMotion()) return;
  const toHeight = container.offsetHeight;
  if (fromHeight === toHeight) return;
  gsap.fromTo(
    container,
    { height: fromHeight, overflow: 'hidden' },
    {
      height: toHeight,
      duration: 0.35,
      ease: PAGE_ENTER.ease,
      overwrite: true,
      clearProps: 'height,overflow',
    },
  );
}

// ── A row's own state change (the agenda ticket advancing a step) ───────────────────────────────

/**
 * A label ADAPTING to its new content: the box eases from the width it had to the width the new
 * label needs while the two labels CROSS-FADE through each other — the same read as a skeleton
 * morphing into its content, and the opposite of a swap (nothing ever blanks out, the size never
 * jumps, and old and new are visible together for a moment).
 *
 * Both halves run on ONE timeline so the resize and the fade are the same gesture. The width target
 * is `auto`, never a measured number: GSAP resolves the natural size at the start of the tween and
 * lands on `auto`, so an interrupted morph simply re-animates from wherever it stands — measuring
 * was what once locked a chip at a half-animated width and clipped it ("Entregad…") for good.
 */
export function morphSwap({
  container,
  incoming,
  outgoing,
}: {
  container: HTMLElement | null;
  incoming: HTMLElement | null;
  outgoing: HTMLElement | null;
}): Promise<void> {
  if (!container || !incoming || prefersReducedMotion()) {
    return Promise.resolve();
  }
  // The starting width is the OUTGOING copy's own: it is out of flow, still painted, and still at
  // its natural size — so nothing has to be measured before the commit (which would mean reading
  // the DOM during render).
  const fromWidth = outgoing?.offsetWidth ?? 0;
  return new Promise((resolve) => {
    const timeline = gsap.timeline({ onComplete: resolve, onInterrupt: resolve });
    if (fromWidth > 0) {
      timeline.fromTo(
        container,
        { width: fromWidth },
        {
          width: 'auto',
          duration: 0.38,
          ease: PAGE_ENTER.ease,
          overwrite: 'auto',
          clearProps: 'width',
        },
        0,
      );
    }
    if (outgoing) {
      timeline.to(
        outgoing,
        { autoAlpha: 0, duration: 0.24, ease: 'power2.in', overwrite: 'auto' },
        0,
      );
    }
    // The incoming label starts rising through as the old one leaves — overlapping, not queued.
    timeline.fromTo(
      incoming,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: 0.3,
        ease: PAGE_ENTER.ease,
        overwrite: 'auto',
        clearProps: 'opacity,visibility',
      },
      0.08,
    );
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
