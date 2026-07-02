import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useBreakpoint from './useBreakpoint';

describe('useBreakpoint', () => {
  it('reports base/mobile when no min-width query matches', () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('base');
    expect(result.current.isMobile).toBe(true);
  });

  it('recomputes on window resize', () => {
    const { result } = renderHook(() => useBreakpoint());
    act(() => globalThis.dispatchEvent(new Event('resize')));
    expect(result.current.breakpoint).toBe('base');
  });

  it('reports the largest matching named breakpoint', () => {
    // A ~lg viewport: matches min-width 1024 and below, not xl/2xl. Restored explicitly at the end.
    const matchMedia = vi.spyOn(globalThis, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('1024px') || q.includes('768px') || q.includes('640px'),
          media: q,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('lg');
    expect(result.current.isMobile).toBe(false);

    matchMedia.mockRestore();
  });

  it.each([
    ['2xl', 1536],
    ['xl', 1280],
    ['md', 768],
    ['sm', 640],
  ])('reports %s at a matching viewport', (bp, viewport) => {
    const matchMedia = vi.spyOn(globalThis, 'matchMedia').mockImplementation((q: string) => {
      const min = Number(q.match(/(\d+)px/)?.[1] ?? '0');
      return {
        matches: min <= viewport,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList;
    });

    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe(bp);

    matchMedia.mockRestore();
  });
});
