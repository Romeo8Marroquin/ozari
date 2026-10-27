/**
 * Pure decisions behind the catalog arrangement page (`ProductArrangePage`) — kept free of React and
 * the DOM so every rule is unit-tested; the page only wires them to state and motion.
 */

/** `ids` with `id` moved to `toIndex` (clamped into range); the same array when nothing moves. */
export function moveId(ids: readonly number[], id: number, toIndex: number): number[] {
  const from = ids.indexOf(id);
  const to = Math.min(Math.max(toIndex, 0), ids.length - 1);
  if (from === -1 || from === to) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Whether two id lists are the same order (and so the same set). */
export function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The order on screen: the admin's local DRAFT reconciled against what the server holds NOW. A
 * background refetch may add or remove products while the admin is arranging, and the save must
 * name exactly the active set — so a product that vanished drops out of the draft, and one that
 * appeared joins it at the FRONT (new products lead the catalog until placed, which is also where
 * the server would show it). With no draft, the server order is the order.
 */
export function reconcileArrangement(
  draft: readonly number[] | null,
  serverIds: readonly number[],
): number[] {
  if (draft === null) return [...serverIds];
  const live = new Set(serverIds);
  const kept = draft.filter((id) => live.has(id));
  const inDraft = new Set(kept);
  const arrived = serverIds.filter((id) => !inDraft.has(id));
  return [...arrived, ...kept];
}

/**
 * The index a keyboard move lands on, or `null` when the key is not a move (or would not move):
 * ArrowLeft/ArrowUp = one earlier, ArrowRight/ArrowDown = one later, Home/End = first/last. Up and
 * Left share a meaning because the grid is read row-major — "earlier" is the only direction that
 * exists in an order, whatever the column count.
 */
export function keyboardMoveTarget(key: string, index: number, length: number): number | null {
  const target =
    key === 'ArrowLeft' || key === 'ArrowUp'
      ? index - 1
      : key === 'ArrowRight' || key === 'ArrowDown'
        ? index + 1
        : key === 'Home'
          ? 0
          : key === 'End'
            ? length - 1
            : null;
  if (target === null || target < 0 || target >= length || target === index) return null;
  return target;
}
