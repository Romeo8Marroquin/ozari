import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useDesktopAutoFocus from './useDesktopAutoFocus';

afterEach(() => vi.restoreAllMocks());

describe('useDesktopAutoFocus', () => {
  it('is false on touch devices (no hover + fine pointer)', () => {
    // The default test matchMedia only matches reduced-motion, so the hover/fine query is false.
    const { result } = renderHook(() => useDesktopAutoFocus());
    expect(result.current).toBe(false);
  });

  it('is true on hover + fine-pointer (desktop/laptop)', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(hover: hover) and (pointer: fine)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    const { result } = renderHook(() => useDesktopAutoFocus());
    expect(result.current).toBe(true);
  });
});
