/**
 * Pure geometry for the gallery's drag-to-reorder — kept free of DOM/GSAP so the reorder decisions
 * are unit-testable; the choreography (lift/track/settle/FLIP) lives in `pageMotion`.
 */

export interface DragPoint {
  x: number;
  y: number;
}

/** The tile box shape the hit test needs (a `DOMRect` satisfies it). */
export interface TileRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The slot the dragged photo should occupy for the current pointer position: the index of the tile
 * (in display order) whose box contains the pointer, or `null` when the pointer is over none (the
 * gaps, the add tile, outside the grid) — meaning "stay where you are". Hovering the dragged
 * tile's own cell naturally returns its own index, which callers treat as a no-op.
 */
export function findReorderIndex(
  point: DragPoint,
  orderedIds: readonly string[],
  rectOf: (id: string) => TileRect | null | undefined,
): number | null {
  for (const [index, id] of orderedIds.entries()) {
    const rect = rectOf(id);
    if (!rect) continue;
    if (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      return index;
    }
  }
  return null;
}

/**
 * The translation that pins the tile's grab point under the pointer. `rect` is the tile's CURRENT
 * box (which already includes `currentTranslation`), so subtracting the translation recovers the
 * tile's resting origin — the math stays correct after a mid-drag reflow moves the resting cell.
 */
export function computeDragTranslation(
  point: DragPoint,
  grabOffset: DragPoint,
  rect: { left: number; top: number },
  currentTranslation: DragPoint,
): DragPoint {
  return {
    x: point.x - grabOffset.x - (rect.left - currentTranslation.x),
    y: point.y - grabOffset.y - (rect.top - currentTranslation.y),
  };
}

/** Straight-line distance between two points — the drag-start threshold check. */
export function dragDistance(a: DragPoint, b: DragPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
