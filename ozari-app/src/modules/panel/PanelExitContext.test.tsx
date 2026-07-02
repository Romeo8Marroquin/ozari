import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PanelExitContext, usePanelExit } from './PanelExitContext';

describe('usePanelExit', () => {
  it('defaults to a no-op that resolves immediately (outside the panel)', async () => {
    const { result } = renderHook(() => usePanelExit());
    await expect(result.current()).resolves.toBeUndefined();
  });

  it('returns the provided exit function', () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PanelExitContext.Provider value={exit}>{children}</PanelExitContext.Provider>
    );
    const { result } = renderHook(() => usePanelExit(), { wrapper });
    expect(result.current).toBe(exit);
  });
});
