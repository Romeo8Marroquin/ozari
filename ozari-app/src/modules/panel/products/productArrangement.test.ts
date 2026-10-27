import { describe, expect, it } from 'vitest';
import { keyboardMoveTarget, moveId, reconcileArrangement, sameOrder } from './productArrangement';

describe('moveId', () => {
  it('moves an id earlier or later, shifting the rest', () => {
    expect(moveId([1, 2, 3, 4], 3, 0)).toEqual([3, 1, 2, 4]);
    expect(moveId([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4]);
  });

  it('clamps the target into range and is a copy when nothing moves', () => {
    const ids = [1, 2, 3];
    expect(moveId(ids, 1, 99)).toEqual([2, 3, 1]);
    expect(moveId(ids, 3, -5)).toEqual([3, 1, 2]);
    const same = moveId(ids, 2, 1);
    expect(same).toEqual(ids);
    expect(same).not.toBe(ids);
    expect(moveId(ids, 42, 0)).toEqual(ids); // unknown id
  });
});

describe('sameOrder', () => {
  it('is true only for the same ids in the same order', () => {
    expect(sameOrder([1, 2], [1, 2])).toBe(true);
    expect(sameOrder([1, 2], [2, 1])).toBe(false);
    expect(sameOrder([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe('reconcileArrangement', () => {
  it('is the server order when there is no draft', () => {
    expect(reconcileArrangement(null, [3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('keeps the draft, drops vanished products and puts arrivals FIRST (new products lead)', () => {
    expect(reconcileArrangement([2, 1, 3], [1, 2, 3])).toEqual([2, 1, 3]);
    expect(reconcileArrangement([2, 1, 3], [9, 1, 3])).toEqual([9, 1, 3]);
  });
});

describe('keyboardMoveTarget', () => {
  it('maps the arrows to one step and Home/End to the ends', () => {
    expect(keyboardMoveTarget('ArrowLeft', 2, 5)).toBe(1);
    expect(keyboardMoveTarget('ArrowUp', 2, 5)).toBe(1);
    expect(keyboardMoveTarget('ArrowRight', 2, 5)).toBe(3);
    expect(keyboardMoveTarget('ArrowDown', 2, 5)).toBe(3);
    expect(keyboardMoveTarget('Home', 2, 5)).toBe(0);
    expect(keyboardMoveTarget('End', 2, 5)).toBe(4);
  });

  it('answers null for other keys and for moves that would not move', () => {
    expect(keyboardMoveTarget('Enter', 2, 5)).toBeNull();
    expect(keyboardMoveTarget('ArrowLeft', 0, 5)).toBeNull();
    expect(keyboardMoveTarget('ArrowRight', 4, 5)).toBeNull();
    expect(keyboardMoveTarget('Home', 0, 5)).toBeNull();
    expect(keyboardMoveTarget('End', 4, 5)).toBeNull();
  });
});
