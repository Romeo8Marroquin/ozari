/**
 * A tiny registry of every currently-open modal's close handler.
 *
 * Each modal's `open` is owned by its parent's state, so nothing *outside* a modal can normally
 * force it shut. The registry fixes that: the `Modal` primitive registers its `onClose` while open,
 * and {@link closeAllModals} calls them all — used by the forced-logout choreography to sweep the
 * screen clean before leaving, regardless of whether a modal is dismissable (a non-dismissable
 * modal's `onClose` still resolves it; it's just not wired to backdrop/Escape).
 *
 * Deliberately a plain module, not a store: nothing needs to *render* from this — it's a
 * fire-and-forget imperative command, so there's no reactive state to hold.
 */

type CloseFn = () => void;

const closers = new Set<CloseFn>();

/** Register an open modal's close handler. Returns an unregister to call on close/unmount. */
export function registerModal(close: CloseFn): () => void {
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}

/** Close every open modal. Iterates a snapshot so a synchronous unregister can't skip an entry. */
export function closeAllModals(): void {
  for (const close of [...closers]) close();
}
