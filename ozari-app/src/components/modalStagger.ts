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
      { x: 0, autoAlpha: 1, duration: 0.4, ease: 'power3.out', stagger: 0.1, delay: 0.05, overwrite: true },
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
 * step transition uses to know when it's safe to swap in the next step's content.
 */
export function playStaggerOut({ content, footer }: StaggerTargets, onComplete?: () => void): void {
  const timeline = gsap.timeline({ onComplete });
  if (content.length) {
    timeline.to(
      content,
      { x: -18, autoAlpha: 0, duration: 0.22, ease: 'power2.in', stagger: { each: 0.065, from: 'end' }, overwrite: true },
      0,
    );
  }
  if (footer) {
    timeline.to(footer, { x: 18, autoAlpha: 0, duration: 0.2, ease: 'power2.in', overwrite: true }, 0);
  }
}
