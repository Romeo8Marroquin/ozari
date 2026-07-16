import { describe, expect, it } from 'vitest';
import { computeDragTranslation, dragDistance, findReorderIndex } from './galleryReorder';
import type { TileRect } from './galleryReorder';

/** A 100×100 tile at (x, y). */
const rect = (left: number, top: number): TileRect => ({
  left,
  top,
  right: left + 100,
  bottom: top + 100,
});

describe('findReorderIndex', () => {
  const rects = new Map<string, TileRect>([
    ['a', rect(0, 0)],
    ['b', rect(120, 0)],
    ['c', rect(240, 0)],
  ]);
  const rectOf = (id: string) => rects.get(id);

  it('returns the index of the tile whose box contains the pointer', () => {
    expect(findReorderIndex({ x: 150, y: 50 }, ['a', 'b', 'c'], rectOf)).toBe(1);
    expect(findReorderIndex({ x: 250, y: 10 }, ['a', 'b', 'c'], rectOf)).toBe(2);
  });

  it('treats the box edges as inside (no dead pixels on the borders)', () => {
    expect(findReorderIndex({ x: 0, y: 0 }, ['a', 'b'], rectOf)).toBe(0);
    expect(findReorderIndex({ x: 220, y: 100 }, ['a', 'b'], rectOf)).toBe(1);
  });

  it('returns null when the pointer is over no tile (the gaps, outside the grid)', () => {
    expect(findReorderIndex({ x: 110, y: 50 }, ['a', 'b', 'c'], rectOf)).toBeNull();
    expect(findReorderIndex({ x: 50, y: 500 }, ['a', 'b', 'c'], rectOf)).toBeNull();
  });

  it('skips ids whose rect is unavailable (the dragged tile hands back null)', () => {
    // The dragged tile ('b') is excluded by its caller returning null — the pointer over its old
    // cell hits nothing, meaning "stay where you are".
    const excludingB = (id: string) => (id === 'b' ? null : rects.get(id));
    expect(findReorderIndex({ x: 150, y: 50 }, ['a', 'b', 'c'], excludingB)).toBeNull();
    expect(findReorderIndex({ x: 50, y: 50 }, ['a', 'b', 'c'], excludingB)).toBe(0);
  });

  it('indexes by the ORDER array, not by any rect layout order', () => {
    expect(findReorderIndex({ x: 50, y: 50 }, ['c', 'b', 'a'], rectOf)).toBe(2);
  });
});

describe('computeDragTranslation', () => {
  it('pins the grab point under the pointer from a resting tile', () => {
    // Grabbed 10px into a tile resting at (100, 200); pointer now at (150, 260).
    expect(
      computeDragTranslation(
        { x: 150, y: 260 },
        { x: 10, y: 10 },
        { left: 100, top: 200 },
        { x: 0, y: 0 },
      ),
    ).toEqual({ x: 40, y: 50 });
  });

  it('recovers the resting origin from a tile already carrying a translation', () => {
    // The tile's CURRENT rect includes the (40, 50) translation → the resting origin is still
    // (100, 200), so the same pointer position yields the same translation (stable tracking).
    expect(
      computeDragTranslation(
        { x: 150, y: 260 },
        { x: 10, y: 10 },
        { left: 140, top: 250 },
        { x: 40, y: 50 },
      ),
    ).toEqual({ x: 40, y: 50 });
  });

  it('stays pointer-locked after a mid-drag reflow moved the resting cell', () => {
    // The reorder moved the tile's cell to (220, 200); the pointer hasn't moved — the translation
    // adjusts so the tile stays exactly in hand.
    expect(
      computeDragTranslation(
        { x: 150, y: 260 },
        { x: 10, y: 10 },
        { left: 260, top: 250 },
        { x: 40, y: 50 },
      ),
    ).toEqual({ x: -80, y: 50 });
  });
});

describe('dragDistance', () => {
  it('is the straight-line distance between the points', () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dragDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});
