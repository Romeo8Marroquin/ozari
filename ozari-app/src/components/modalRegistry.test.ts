import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllModals, registerModal } from './modalRegistry';

// The registry is module-level state, so track every registration and clear it after each test.
const cleanups: Array<() => void> = [];
const track = (fn: () => void): (() => void) => {
  const unregister = registerModal(fn);
  cleanups.push(unregister);
  return unregister;
};
afterEach(() => {
  cleanups.splice(0).forEach((u) => u());
});

describe('modalRegistry', () => {
  it('closeAllModals invokes every registered close handler', () => {
    const a = vi.fn();
    const b = vi.fn();
    track(a);
    track(b);

    closeAllModals();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unregister removes a handler so it is no longer swept', () => {
    const a = vi.fn();
    const unregister = track(a);
    unregister();

    closeAllModals();

    expect(a).not.toHaveBeenCalled();
  });

  it('iterates a snapshot — a handler that unregisters itself does not skip the next one', () => {
    const calls: string[] = [];
    let unregisterA = (): void => {};
    const a = vi.fn(() => {
      calls.push('a');
      unregisterA(); // mutate the set mid-iteration
    });
    const b = vi.fn(() => calls.push('b'));

    unregisterA = track(a);
    track(b);

    closeAllModals();

    expect(calls).toEqual(['a', 'b']);
  });
});
