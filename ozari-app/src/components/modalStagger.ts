import gsap from 'gsap';

/**
 * The modal's shared "sweep" language, in one place so the {@link Modal} open/close animation and the
 * {@link useModalPhaseTransition} step-to-step transition read as the exact same motion.
 *
 * Content blocks are tagged `.modal-stagger` (title, description, each body block); the action row is
 * tagged `.modal-stagger-footer`. On the way IN the content sweeps from the LEFT (staggered
 * top→bottom) while the footer comes from the RIGHT; on the way OUT it's the mirror — content leaves
 * to the LEFT (reverse order) and the footer to the RIGHT.
 */

const CONTENT_SELECTOR = '.modal-stagger';
const FOOTER_SELECTOR = '.modal-stagger-footer';

/**
 * The stagger is CAPPED, not per-item — the same rule the panel's page wave follows (`waveDelays`
 * in `pageMotion`): the total spread is bounded, so a modal's entrance takes about the same time
 * whether it has three blocks or seven.
 *
 * Without this the step is a flat 0.1s each and the sweep grows with the content: the location
 * picker (title + description + five blocks) ran ~1.05s and read as sluggish next to a two-block
 * confirm dialog, even though both use "the same" animation. Small modals keep exactly the timing
 * they always had — the cap only ever tightens a long one.
 */
const IN_STEP = 0.1;
const IN_SPREAD_BUDGET = 0.26;
const OUT_STEP = 0.065;
const OUT_SPREAD_BUDGET = 0.16;

/** The per-item delay that keeps `count` items inside `budget`, never exceeding `step`. */
const cappedStep = (count: number, step: number, budget: number): number =>
  count > 1 ? Math.min(step, budget / (count - 1)) : step;

export interface StaggerTargets {
  /** The content blocks, in DOM (top→bottom) order. */
  content: HTMLElement[];
  /** The action row, if the modal has one. */
  footer: HTMLElement | null;
}

/** Gather the staggerable content + footer under a panel (or any sub-tree). */
export function collectStaggerTargets(root: HTMLElement): StaggerTargets {
  return {
    content: Array.from(root.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)),
    footer: root.querySelector<HTMLElement>(FOOTER_SELECTOR),
  };
}

/** Sweep the content in from the left (staggered) and the footer in from the right. */
export function playStaggerIn({ content, footer }: StaggerTargets): void {
  if (content.length) {
    gsap.fromTo(
      content,
      { x: -20, autoAlpha: 0 },
      {
        x: 0,
        autoAlpha: 1,
        duration: 0.4,
        ease: 'power3.out',
        stagger: cappedStep(content.length, IN_STEP, IN_SPREAD_BUDGET),
        delay: 0.05,
        overwrite: true,
      },
    );
  }
  if (footer) {
    gsap.fromTo(
      footer,
      { x: 20, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.4, ease: 'power3.out', delay: 0.05, overwrite: true },
    );
  }
}

/**
 * Sweep the content out to the left (reverse order) and the footer out to the right — the mirror of
 * {@link playStaggerIn}. `onComplete` (if given) fires once the whole sweep has finished, which the
 * step transition uses to know when it's safe to swap in the next step's content. Returns the
 * timeline so a caller can kill a still-running sweep before starting a new one (a rapid phase
 * flip must cancel the pending commit, not stack a second one).
 */
export function playStaggerOut({ content, footer }: StaggerTargets, onComplete?: () => void): gsap.core.Timeline {
  const timeline = gsap.timeline({ onComplete });
  if (content.length) {
    timeline.to(
      content,
      {
        x: -18,
        autoAlpha: 0,
        duration: 0.22,
        ease: 'power2.in',
        stagger: { each: cappedStep(content.length, OUT_STEP, OUT_SPREAD_BUDGET), from: 'end' },
        overwrite: true,
      },
      0,
    );
  }
  if (footer) {
    timeline.to(footer, { x: 18, autoAlpha: 0, duration: 0.2, ease: 'power2.in', overwrite: true }, 0);
  }
  return timeline;
}
