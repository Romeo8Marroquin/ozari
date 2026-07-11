import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_ENTER, PAGE_ENTER_STAGGER, PAGE_EXIT, PAGE_EXIT_STAGGER, prefersReducedMotion } from './motion';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const setReduce = (reduce: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('prefersReducedMotion', () => {
  it('is true when the OS asks for reduced motion', () => {
    setReduce(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false otherwise', () => {
    setReduce(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('panel motion tokens', () => {
  it('keeps the asymmetric out/in contract (fast accelerating exit, slower settling enter)', () => {
    expect(PAGE_EXIT).toEqual({ duration: 0.2, ease: 'power2.in' });
    expect(PAGE_ENTER).toEqual({ duration: 0.45, ease: 'power3.out' });
    expect(PAGE_EXIT.duration).toBeLessThan(PAGE_ENTER.duration);
    // Stagger BUDGETS (total, element-count independent) — exits sweep tighter than enters.
    expect(PAGE_EXIT_STAGGER).toBeLessThan(PAGE_ENTER_STAGGER);
  });
});
