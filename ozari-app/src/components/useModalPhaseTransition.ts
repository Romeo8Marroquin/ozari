import gsap from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { collectStaggerTargets, playStaggerIn, playStaggerOut } from './modalStagger';

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Transitions a modal's content between "phases" (e.g. an MFA wizard's scan → recovery step) using
 * the **same sweep as the modal's own open/close** — the whole panel (title, body blocks, footer)
 * leaves like a close, the next phase enters like an open, and the panel resizes across the swap.
 *
 * The panel stays mounted, so there's no open/close to ride: this hook re-creates that motion by
 * decoupling the *target* phase from the *rendered* one. On a change it (1) sweeps the current
 * content OUT (`playStaggerOut`), (2) only then commits the new phase (so the parent still shows the
 * old content while it leaves), then (3) sweeps the new content IN (`playStaggerIn`) while tweening
 * the panel HEIGHT from the old to the new size — the body is clipped during the resize so taller
 * incoming content is revealed by the growing panel rather than spilling.
 *
 * The consumer renders the returned `rendered` phase (not its target) and passes the same `panelRef`
 * it hands to `Modal`. Under `prefers-reduced-motion` (and jsdom, which reports it) the swap is
 * immediate — same final, accessible DOM. Pure GSAP orchestration → coverage-excluded like
 * `useAuthCard.ts`; verified visually.
 *
 * @param target    the phase the consumer wants shown
 * @param panelRef  the modal panel (its `.modal-stagger`/`.modal-stagger-footer` nodes are swept)
 * @returns the phase currently on screen — render THIS, lagging `target` by one out-sweep
 */
export function useModalPhaseTransition<T>(
  target: T,
  panelRef: React.RefObject<HTMLElement | null>,
): T {
  const [rendered, setRendered] = useState<T>(target);
  // Panel height captured just before the out-sweep, handed to the in-sweep across the swap.
  const fromHeight = useRef<number | null>(null);

  // Target diverged from what's on screen → sweep the current content OUT, then commit the swap.
  useEffect(() => {
    if (target === rendered) return;
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion()) {
      setRendered(target);
      return;
    }
    fromHeight.current = panel.getBoundingClientRect().height;
    playStaggerOut(collectStaggerTargets(panel), () => setRendered(target));
  }, [target, rendered, panelRef]);

  // New content committed → sweep it IN and tween the panel height old→new. Runs only when an
  // out-sweep recorded a height (the animated path); the initial mount and reduced-motion swap
  // leave `fromHeight` null and no-op.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const from = fromHeight.current;
    fromHeight.current = null;
    if (!panel || from === null) return;

    const to = panel.getBoundingClientRect().height;
    if (to !== from) {
      // Clip the scroll body while the panel resizes so the (possibly taller) new content is
      // revealed by the growth instead of triggering a transient scrollbar.
      const body = panel.querySelector<HTMLElement>('[data-modal-body]');
      gsap.set(panel, { height: from });
      if (body) gsap.set(body, { overflow: 'hidden' });
      gsap.to(panel, {
        height: to,
        duration: 0.4,
        ease: 'power3.out',
        overwrite: true,
        clearProps: 'height',
        onComplete: () => {
          if (body) gsap.set(body, { clearProps: 'overflow' });
        },
      });
    }

    playStaggerIn(collectStaggerTargets(panel));
  }, [rendered, panelRef]);

  return rendered;
}
