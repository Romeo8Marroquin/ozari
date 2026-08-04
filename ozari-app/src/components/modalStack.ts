import { useCallback, useSyncExternalStore } from 'react';

/**
 * WHO IS ON TOP — the open modals, in the order they opened.
 *
 * It exists for one rule: **only the topmost modal shows a backdrop.** Every modal drawing its own
 * scrim meant that opening a dialog from inside a dialog stacked two 45% blacks and two blurs, so
 * the page behind went visibly darker and mushier the deeper you went — and the first modal, which
 * the user can still see, ended up dimmed as if it were disabled. What should read as "you stepped
 * one level in" read as "something went wrong".
 *
 * With a stack, the answer is simple at any depth: the top modal owns the scrim, everyone below
 * shows only their panel. Opening #3 hides #2's scrim; closing #3 hands it straight back.
 *
 * Identity is the caller's own object (a ref), never an index: a modal must be able to leave the
 * middle of the stack (a forced-logout sweep closes them all at once) without renumbering anyone.
 */

type ModalId = object;

let stack: ModalId[] = [];
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of [...listeners]) listener();
};

/** Push a modal onto the stack while it is open; the returned function pops it. */
export function pushModal(id: ModalId): () => void {
  stack = [...stack, id];
  emit();
  return () => {
    stack = stack.filter((entry) => entry !== id);
    emit();
  };
}

export function subscribeModalStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Is this modal the one currently on top (and therefore the one that owns the backdrop)? */
export function useIsTopModal(id: ModalId): boolean {
  const snapshot = useCallback(() => stack[stack.length - 1] === id, [id]);
  return useSyncExternalStore(subscribeModalStack, snapshot, snapshot);
}

/**
 * Is this modal IN the stack with something above it?
 *
 * Deliberately not `!isTop`: a modal is not yet on the stack during its first render after opening
 * (the push happens in an effect), and "not top" would call that moment *covered* — which made an
 * opening modal think it was yielding the scrim it is in fact arriving with.
 */
export function useIsCoveredModal(id: ModalId): boolean {
  const snapshot = useCallback(
    () => stack.includes(id) && stack[stack.length - 1] !== id,
    [id],
  );
  return useSyncExternalStore(subscribeModalStack, snapshot, snapshot);
}

/**
 * How many modals are open right now. Read at the moment one OPENS, to know whether it is arriving
 * over an existing scrim (see the hand-over note in `Modal`).
 */
export const getModalStackSize = (): number => stack.length;

/** Is some OTHER modal open? Tells a scrim whether it is part of a hand-over (and must therefore
 *  animate as one half of a complementary pair) or simply appearing/disappearing on its own. */
export function useOtherModalOpen(id: ModalId): boolean {
  const snapshot = useCallback(() => stack.some((entry) => entry !== id), [id]);
  return useSyncExternalStore(subscribeModalStack, snapshot, snapshot);
}
