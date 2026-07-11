/**
 * The single home for the app's motion SYSTEM: the reduced-motion probe every animated surface
 * shares, and the panel's motion tokens. Timings are asymmetric by design — exits are fast and
 * accelerating (the user already decided to leave), enters are slower and settling (the new view
 * "arrives") — roughly the 1:2 out/in ratio of standard motion practice. Auth-card timings live in
 * `useAuthCard` on purpose: a full-view transition may read slower than an in-panel content swap.
 */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Panel content exit: quick lift + fade, accelerating out. */
export const PAGE_EXIT = { duration: 0.2, ease: 'power2.in' } as const;

/** Panel content enter: settle into place, decelerating. */
export const PAGE_ENTER = { duration: 0.45, ease: 'power3.out' } as const;

/**
 * Stagger BUDGETS (a fixed total distributed across however many elements a page has), so a
 * transition's TOTAL time is constant — 2 cards or 20, the page always leaves in
 * `PAGE_EXIT.duration + PAGE_EXIT_STAGGER` and arrives in `PAGE_ENTER.duration +
 * PAGE_ENTER_STAGGER`. How the budget is distributed is `pageMotion`'s wave logic (rows dominate,
 * columns ripple within a row), so a dense grid still reads as a cascade, not a simultaneous pop.
 */
export const PAGE_EXIT_STAGGER = 0.12;
export const PAGE_ENTER_STAGGER = 0.35;
