import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PanelNavContext, usePanelNavigate } from './PanelNavContext';

describe('usePanelNavigate', () => {
  it('defaults to a no-op (outside the panel)', () => {
    const { result } = renderHook(() => usePanelNavigate());
    expect(() => result.current('/panel/productos')).not.toThrow();
  });

  it('returns the provided navigate function', () => {
    const navigate = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PanelNavContext.Provider value={navigate}>{children}</PanelNavContext.Provider>
    );
    const { result } = renderHook(() => usePanelNavigate(), { wrapper });
    result.current('/panel/clientes');
    expect(navigate).toHaveBeenCalledWith('/panel/clientes');
  });
});
