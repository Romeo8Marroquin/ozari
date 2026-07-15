import gsap from 'gsap';
import { PAGE_ENTER, prefersReducedMotion } from '@utils/motion';

/**
 * The card⇄detail **shared-element image transition** — the web implementation of the classic
 * "hero animation id" idiom (Flutter Hero / Android sharedElement): the SAME logical element,
 * identified by the product id (`data-morph-id`), exists on both pages, and ONE visual travels
 * between them WHILE the page transition plays. Both directions; ONLY the in-app navigations that
 * bind the two pages — every other arrival is the standard choreography, untouched.
 *
 * The browser can't do this natively across our GSAP-driven route swap (View Transitions are
 * deliberately disabled — they fight the panel timelines), so the idiom is implemented manually:
 *
 *  1. `beginProductImageMorph(id, img, estimate?)` — at click time, a fixed-position CLONE of the
 *     photo is portaled to `<body>` at the photo's exact rect (`--z-float-body`) and starts MOVING
 *     IMMEDIATELY (the click is t=0): toward the predicted destination when one is known
 *     ({@link estimateDetailHeroRect}) or a whisper of a drift otherwise. The photo's own cell is
 *     dimmed at once — only the image travels; nothing lingers behind it.
 *  2. `claimProductImageMorph(id, target, reveal?, onSettled?)` — when the destination with the
 *     SAME id mounts, `reveal` is hidden and the measured rect is compared with the flight's
 *     destination: CONFIRMED (within tolerance) → nothing restarts, the single in-progress tween
 *     simply finishes (one continuous curve — a restarted ease reads as a felt "bump" even with
 *     perfect rects); genuinely STALE (sidebar toggled, resize) → one graceful correction tween
 *     overwrites from the current frame. On arrival the real element is revealed under a quick
 *     clone fade (same `src` ⇒ cache ⇒ pixel-continuous) and `onSettled` fires so the caller can
 *     rejoin the page's motion vocabulary. A claim for a DIFFERENT id is a no-op. The LANDING is
 *     tracked: interrupting it (a new begin, a release) FINALIZES it — the hidden element is
 *     re-revealed and `onSettled` still fires, so nothing is ever left invisible or outside the
 *     page staggers.
 *
 * Timing: the drift covers the page exit and the retarget lands within the entrance — the travel
 * is essentially part of the transition, not an animation the user waits on afterwards.
 *
 * **Decoration, never load-bearing** — reduced motion / no photo → nothing is stashed; cancelled
 * navigation or a cold destination → safety timeout or explicit `release` fades the clone and the
 * standard choreography proceeds. Nothing here blocks, delays, or owns the navigation.
 *
 * Pure GSAP/DOM orchestration — coverage-excluded like its visual peers (`pageMotion.ts`); the
 * components' DECISIONS (when to begin/claim/release) are what the unit tests pin.
 */

export interface MorphRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MorphStash {
  productId: number;
  clone: HTMLImageElement;
  /** The in-progress travel toward the known destination (null = blind drift, no destination). */
  flight: { tween: gsap.core.Tween; destination: MorphRect } | null;
}

interface MorphLanding {
  clone: HTMLImageElement;
  reveal: HTMLElement | null;
  onSettled: (() => void) | null;
}

let stash: MorphStash | null = null;
let landing: MorphLanding | null = null;
let safetyTimer: number | null = null;

/**
 * The RETURN destination: the card rect captured at forward lift-off. The return restores the
 * grid's exact scroll, so this rect is pixel-correct for the back flight — the clone flies
 * straight at the true card position instead of drifting blind. Guarded by a LAYOUT SIGNATURE:
 * anything that reflows the content column (sidebar expand/collapse, resize) invalidates it —
 * flying to a dead position is worse than the correction path.
 */
let returnTarget: { productId: number; rect: MorphRect; signature: string | null } | null = null;

/**
 * The MEASURED detail-hero rect from a previous claimed arrival, keyed by viewport size AND the
 * layout signature (a resize or sidebar toggle invalidates it). Once known, forward flights aim at
 * the REAL rect — the computed estimate below (which reads the LIVE layout, so it self-adapts to
 * the sidebar) is the first-visit fallback.
 */
let knownHeroRect: {
  rect: MorphRect;
  viewportWidth: number;
  viewportHeight: number;
  signature: string | null;
} | null = null;

/**
 * The content column's identity: its left edge + width. Changes when the sidebar or viewport do —
 * and ONLY then. Measured on `.panel-screen` ITSELF (identical geometry on every page), never on a
 * page's root: page roots differ per page (the grid is full-width, the detail caps at `max-w-5xl`),
 * so signing with them made the signature differ BETWEEN THE TWO BOUND PAGES on wide screens —
 * every valid cached destination was discarded on laptop/desktop while narrow viewports (where
 * both roots share a width) worked perfectly.
 */
function layoutSignature(): string | null {
  const screenEl = document.querySelector('.panel-screen');
  if (!screenEl) return null;
  const box = screenEl.getBoundingClientRect();
  return `${Math.round(box.left)}:${Math.round(box.width)}`;
}

/** How long an unclaimed clone may float before it self-dismisses (covers cancelled navigations). */
const SAFETY_TIMEOUT_MS = 1500;
/**
 * The FLIGHT — one single tween from the source rect to the destination, started on the click and
 * never restarted. Shorter than the page EXIT (~0.32s) ON PURPOSE: the travel is fully finished
 * before the route commits, so nothing can ever interleave with it. `power2.inOut` = the app's
 * motion character — eases out of the source, quick through the middle, eases into the landing.
 *
 * OWNER-TUNED (2026-07-14): 0.3s + `power3.inOut`, pinned. The steepness is deliberate: at 0.3s a
 * mild curve (power2) compresses the accel/brake phases into imperceptibility — it READS as
 * linear. power3's stronger ends/faster middle is what makes the S-profile visible at this speed.
 * (An earlier inOut attempt read as a "bump", but the real culprit was the hover-zoom sizing bug —
 * the flight was landing on a wrong-size target; with frame-based geometry the smooth curve is
 * correct.) If revisited, change ONLY this constant and re-verify every breakpoint, hovered and
 * unhovered.
 */
const FLIGHT = { duration: 0.3, ease: 'power3.inOut' } as const;
/**
 * The PRECISION SETTLE: once the destination mounts and confirms the flight, the clone glides the
 * final sub-tolerance residue onto the EXACT measured rect. Never restarts the flight (it always
 * completes naturally first); ≤2px over 0.12s is imperceptible — a parked 2px offset was not.
 */
const SETTLE = { duration: 0.12, ease: 'power1.out' } as const;
/** The graceful CORRECTION for a genuinely stale destination (sidebar toggled, resize) — the only
 *  path that ever retargets mid-motion, overwriting from the current frame. */
const CORRECTION = { duration: 0.25, ease: PAGE_ENTER.ease } as const;
/** How far (px, per edge) a measured rect may differ from the flight destination and still count
 *  as "confirmed" (→ precision settle) rather than stale (→ correction). */
const DESTINATION_TOLERANCE_PX = 2;
const FADE = { duration: 0.12, ease: 'power2.inOut' } as const;

/**
 * Predict where the detail hero will land BEFORE the detail page exists — its layout is
 * deterministic: a centered `max-w-5xl` column inside the (padded) panel screen, the hero
 * full-width (4:3) below the back row, or the left half (`gap-10`) from `lg`. Vertically it's
 * anchored to the SCROLL CONTAINER's viewport (the detail always opens scrolled to the top), so a
 * scrolled grid doesn't skew the guess. Only a prediction — the claim corrects to the measured
 * rect — but it lets the travel start on the click itself.
 */
export function estimateDetailHeroRect(): MorphRect | null {
  // A previously MEASURED hero rect at this viewport + layout is the exact answer — prefer it.
  if (
    knownHeroRect &&
    knownHeroRect.viewportWidth === window.innerWidth &&
    knownHeroRect.viewportHeight === window.innerHeight &&
    knownHeroRect.signature === layoutSignature()
  ) {
    return knownHeroRect.rect;
  }
  const screenEl = document.querySelector('.panel-screen');
  const page = screenEl?.firstElementChild;
  if (!screenEl || !page) return null;
  const box = page.getBoundingClientRect();
  const scrollerBox = (screenEl.parentElement ?? screenEl).getBoundingClientRect();
  const contentWidth = Math.min(box.width, 1024); // max-w-5xl = 64rem
  const contentLeft = box.left + (box.width - contentWidth) / 2;
  const heroWidth = window.innerWidth >= 1024 ? (contentWidth - 40) / 2 : contentWidth; // lg: gap-10 split
  const padding = window.innerWidth >= 1024 ? 32 : window.innerWidth >= 768 ? 24 : 16; // p-4/md:6/lg:8
  const top = scrollerBox.top + padding + 44; // + the back row (~20px) and the page's gap-6
  return { left: contentLeft, top, width: heroWidth, height: (heroWidth * 3) / 4 };
}

function dropSafetyTimer(): void {
  if (safetyTimer !== null) {
    window.clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

/**
 * Finalize an in-progress LANDING: re-reveal the hidden real element, notify the owner, and
 * dismiss the clone. Runs on natural completion AND on any interruption — the invariant is that a
 * hidden element/withheld class can never outlive its morph.
 */
function finishLanding(instant: boolean): void {
  const current = landing;
  landing = null;
  if (!current) return;
  gsap.killTweensOf(current.clone);
  if (current.reveal) gsap.set(current.reveal, { autoAlpha: 1 });
  current.onSettled?.();
  if (instant) {
    current.clone.remove();
    return;
  }
  gsap.to(current.clone, {
    autoAlpha: 0,
    duration: FADE.duration,
    ease: FADE.ease,
    overwrite: true,
    onComplete: () => current.clone.remove(),
  });
}

/**
 * Whether a morph is already underway (a clone in flight or a landing in progress). Lets the
 * browser-back path skip lifting off when the in-app back affordance already did (it begins the
 * morph BEFORE navigating, so by unmount time it is always in flight).
 */
export function hasProductImageMorphInFlight(): boolean {
  return stash !== null || landing !== null;
}

/** Dismiss the floating clone (unclaimed OR mid-landing) and restore anything a landing hid. */
export function releaseProductImageMorph(instant = false): void {
  dropSafetyTimer();
  finishLanding(instant);
  const current = stash;
  stash = null;
  if (!current) return;
  if (instant) {
    gsap.killTweensOf(current.clone);
    current.clone.remove();
    return;
  }
  gsap.to(current.clone, {
    autoAlpha: 0,
    duration: FADE.duration,
    ease: FADE.ease,
    overwrite: true,
    onComplete: () => current.clone.remove(),
  });
}

/**
 * Source side (card photo or detail hero, at click time): snapshot the photo into a fixed clone,
 * set it in motion, and take the photo's own cell out of view (only the image travels — nothing
 * lingers behind it). Direction is inferred from `estimate`:
 *  - FORWARD (an estimate given — the card click): the source rect is remembered as the RETURN
 *    target, and the source cell soft-fades (it carries text/scrim that would pop otherwise);
 *  - BACK (no estimate — the detail's back affordance): the flight aims at the remembered return
 *    rect, and the source (the hero — a bare image the clone covers 1:1) hides INSTANTLY, so the
 *    page exit can never be seen sweeping it "upwards" behind the clone.
 * No-ops under reduced motion or without a usable photo.
 */
export function beginProductImageMorph(
  productId: number,
  image: HTMLImageElement | null,
  estimate: MorphRect | null = null,
): void {
  releaseProductImageMorph(true); // a previous unclaimed clone must never linger
  if (!image || prefersReducedMotion()) return;
  // Geometry comes from the photo's FRAME (the card tile / hero wrap), never the <img> itself:
  // the card zooms its image on hover (`scale-[1.06]`, clipped by the tile's overflow-hidden), so
  // at click time the img rect is the ZOOMED one — sourcing it made the clone (and the remembered
  // return target) ~6% too big on hover-capable devices, which is exactly the desktop-only
  // "lands big, then resizes down" glitch. The frame rect is what's actually VISIBLE, always.
  const frame = image.parentElement ?? image;
  const rect = frame.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const forward = estimate !== null;
  if (forward) {
    // The card's rect — pixel-correct for the back flight (the return restores this scroll), as
    // long as the layout hasn't reflowed in between (the signature guards that).
    returnTarget = {
      productId,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      signature: layoutSignature(),
    };
  }
  const destination = forward
    ? estimate
    : returnTarget &&
        returnTarget.productId === productId &&
        returnTarget.signature === layoutSignature()
      ? returnTarget.rect
      : null;

  const clone = document.createElement('img');
  clone.src = image.currentSrc || image.src;
  clone.alt = '';
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    objectFit: 'cover',
    borderRadius: 'var(--radius-card)',
    zIndex: 'var(--z-float-body)',
    pointerEvents: 'none',
    margin: '0',
  });
  document.body.appendChild(clone);

  // The source vanishes NOW — only the clone remains at the origin. Forward: a soft fade (the
  // card cell carries text/scrim; the exit sweep overwrites-and-continues the tween). Back: an
  // INSTANT hide — the hero is a bare image the clone covers exactly, so this is imperceptible,
  // and the exit can never be seen moving it behind the clone.
  const sourceCell = image.closest('.reveal-item');
  if (sourceCell) {
    if (forward) {
      gsap.to(sourceCell, { autoAlpha: 0, duration: 0.2, ease: 'power2.in', overwrite: true });
    } else {
      gsap.set(sourceCell, { autoAlpha: 0 });
    }
  }

  // ONE continuous flight from the very first frame — the claim will hook its completion rather
  // than restart it (no velocity kink, ever). Without a destination (should not happen in the
  // bound flows) a whisper of a drift keeps the clone from reading as frozen.
  let flight: MorphStash['flight'] = null;
  if (destination) {
    const tween = gsap.to(clone, { ...destination, duration: FLIGHT.duration, ease: FLIGHT.ease });
    flight = { tween, destination };
  } else {
    gsap.to(clone, { scale: 0.97, duration: FLIGHT.duration, ease: FLIGHT.ease });
  }
  stash = { productId, clone, flight };
  safetyTimer = window.setTimeout(() => releaseProductImageMorph(), SAFETY_TIMEOUT_MS);
}

/**
 * Target side (detail hero / grid card, on mount): if a clone with the SAME animation id is in
 * flight, hide `reveal` (defaults to the target), retarget the clone onto the target's measured
 * rect, then reveal under the clone's fade and fire `onSettled`. A DIFFERENT id in flight is a
 * no-op — the caller isn't this clone's destination. Returns whether a morph was claimed.
 */
export function claimProductImageMorph(
  productId: number,
  target: HTMLElement | null,
  reveal: HTMLElement | null = target,
  onSettled: (() => void) | null = null,
): boolean {
  // The direct claim is the DETAIL hero's — its measured rect is the same for every product at
  // this viewport, so remember it: later forward flights aim at the REAL rect, not the estimate.
  return performClaim(productId, target, reveal, onSettled, true);
}

function performClaim(
  productId: number,
  target: HTMLElement | null,
  reveal: HTMLElement | null,
  onSettled: (() => void) | null,
  recordHeroRect: boolean,
): boolean {
  if (!stash) return false;
  if (stash.productId !== productId) return false; // someone else's clone — leave it in flight
  if (!target) {
    // OUR destination exists but can't host the morph (no photo/cold) — dismiss the clone.
    releaseProductImageMorph();
    return false;
  }
  dropSafetyTimer();
  const { clone, flight } = stash;
  stash = null;

  const rect = target.getBoundingClientRect();
  if (recordHeroRect) {
    knownHeroRect = {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      signature: layoutSignature(),
    };
  }
  if (reveal) gsap.set(reveal, { autoAlpha: 0 });
  landing = { clone, reveal, onSettled };

  // The measured rect CONFIRMS the flight's destination → never restart the flight (a restarted
  // ease reads as a felt "bump" even with perfect rects): it completes naturally, then a tiny
  // PRECISION SETTLE glides the sub-tolerance residue onto the EXACT measured rect before the
  // handoff — pixel-perfect landings, no masked offsets. Only a genuinely different rect (the
  // destination went stale: sidebar toggled, resize, reflow) takes the correction path.
  const confirmed =
    flight !== null &&
    Math.abs(rect.left - flight.destination.left) <= DESTINATION_TOLERANCE_PX &&
    Math.abs(rect.top - flight.destination.top) <= DESTINATION_TOLERANCE_PX &&
    Math.abs(rect.width - flight.destination.width) <= DESTINATION_TOLERANCE_PX &&
    Math.abs(rect.height - flight.destination.height) <= DESTINATION_TOLERANCE_PX;
  if (confirmed) {
    const settle = (): void => {
      gsap.to(clone, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        scale: 1,
        duration: SETTLE.duration,
        ease: SETTLE.ease,
        overwrite: true,
        onComplete: () => finishLanding(false),
      });
    };
    if (flight.tween.isActive()) {
      flight.tween.eventCallback('onComplete', settle);
    } else {
      settle(); // the flight already parked — just align exactly and hand off
    }
    return true;
  }

  gsap.to(clone, {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: getComputedStyle(target).borderRadius,
    scale: 1, // undo any blind drift
    duration: CORRECTION.duration,
    ease: CORRECTION.ease,
    overwrite: true, // continue from the current frame — a curve, never a jump
    onComplete: () => finishLanding(false),
  });
  return true;
}

/**
 * Grid-side claim: locate this clone's destination card ANYWHERE in `scope` (the page mounts 24
 * cards; only the tagged one is the destination), hold its CELL out of the entrance wave, and land
 * on the tile. `onSettled` (or any interruption) rejoins the cell to the page staggers. Call AFTER
 * restoring the grid's scroll — the landing rect must be measured where the card really is.
 */
export function claimProductImageMorphWithin(scope: HTMLElement | null): boolean {
  if (!stash) return false;
  const image = scope?.querySelector<HTMLImageElement>(`img[data-morph-id="${stash.productId}"]`);
  if (!image) {
    // The grid rendered without this product (filters/pagination changed underneath) — dismiss.
    releaseProductImageMorph();
    return false;
  }
  const tile = image.closest('article') ?? image;
  const cell = image.closest('.reveal-item');
  cell?.classList.remove('reveal-item');
  // A card rect is per-product/per-scroll — never recorded as the hero rect.
  return performClaim(
    stash.productId,
    tile as HTMLElement,
    image,
    () => cell?.classList.add('reveal-item'),
    false,
  );
}
