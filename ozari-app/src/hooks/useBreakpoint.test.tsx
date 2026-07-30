import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useBreakpoint from './useBreakpoint';

/** A matchMedia stand-in for a viewport of `width`, recording every registered change handler so a
 *  test can fire a real breakpoint CROSSING (the only thing the shared store listens to). */
const mockViewport = (width: number, handlers: Array<() => void> = []) =>
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) => {
    const min = Number(query.match(/(\d+)px/)?.[1] ?? '0');
    return {
      matches: min <= width,
      media: query,
      addEventListener: (_: string, handler: () => void) => handlers.push(handler),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
  });

describe('useBreakpoint', () => {
  it('reports base/mobile when no min-width query matches', () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('base');
    expect(result.current.isMobile).toBe(true);
  });

  it('reports the largest matching named breakpoint', () => {
    const matchMedia = mockViewport(1024); // a ~lg viewport: lg/md/sm match, xl/2xl don't
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
    const matchMedia = mockViewport(viewport);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe(bp);
    matchMedia.mockRestore();
  });

  it('updates every consumer when a breakpoint is CROSSED', () => {
    const handlers: Array<() => void> = [];
    let matchMedia = mockViewport(500, handlers);
    // Two consumers, as a list renders: they must share ONE set of media queries…
    const first = renderHook(() => useBreakpoint());
    const second = renderHook(() => useBreakpoint());
    expect(first.result.current.breakpoint).toBe('base');
    expect(second.result.current.isMobile).toBe(true);
    // …five queries registered ONCE for both hooks, not once per hook.
    expect(handlers).toHaveLength(5);

    // The window grows past `lg`: the media queries fire, the shared snapshot re-measures once.
    matchMedia.mockRestore();
    matchMedia = mockViewport(1024, []);
    act(() => handlers[0]());
    expect(first.result.current.breakpoint).toBe('lg');
    expect(second.result.current.breakpoint).toBe('lg');
    expect(second.result.current.isMobile).toBe(false);

    // A fire that crosses nothing re-measures but never re-renders (the snapshot stays identical).
    const stable = first.result.current;
    act(() => handlers[1]());
    expect(first.result.current).toBe(stable);

    first.unmount();
    second.unmount();
    matchMedia.mockRestore();
  });
});
