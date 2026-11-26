import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRetainedTotal } from './orderProgress';
import type { OrderProgress } from './order.types';

describe('useRetainedTotal', () => {
  it('follows the live count while the API sends one', () => {
    const { result, rerender } = renderHook(
      ({ progress }: { progress?: OrderProgress }) => useRetainedTotal(progress),
      { initialProps: { progress: { step: 1, total: 5 } } },
    );
    expect(result.current).toBe(5);
    rerender({ progress: { step: 3, total: 3 } });
    expect(result.current).toBe(3);
  });

  it('REMEMBERS the last count once progress disappears, so a cancelled bar drains in place', () => {
    const { result, rerender } = renderHook(
      ({ progress }: { progress?: OrderProgress }) => useRetainedTotal(progress),
      { initialProps: { progress: { step: 2, total: 5 } as OrderProgress | undefined } },
    );
    rerender({ progress: undefined });
    expect(result.current).toBe(5);
  });

  it('knows nothing when it never saw a count', () => {
    const { result } = renderHook(() => useRetainedTotal(undefined));
    expect(result.current).toBeUndefined();
  });
});
