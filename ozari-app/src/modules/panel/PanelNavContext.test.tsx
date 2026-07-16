import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PanelNavContext, usePanelNavigate, usePanelNavPending, type PanelNav } from './PanelNavContext';

describe('usePanelNavigate', () => {
  it('defaults to a no-op (outside the panel)', () => {
    const { result } = renderHook(() => usePanelNavigate());
    expect(() => result.current('/panel/productos')).not.toThrow();
  });

  it('returns the provided navigate function', () => {
    const navigateTo = vi.fn();
    const value: PanelNav = { navigateTo, pending: null };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PanelNavContext.Provider value={value}>{children}</PanelNavContext.Provider>
    );
    const { result } = renderHook(() => usePanelNavigate(), { wrapper });
    result.current('/panel/ajustes');
    expect(navigateTo).toHaveBeenCalledWith('/panel/ajustes');
  });
});

describe('usePanelNavPending', () => {
  it('defaults to null (idle / outside the panel)', () => {
    const { result } = renderHook(() => usePanelNavPending());
    expect(result.current).toBeNull();
  });

  it('returns the provided in-flight destination', () => {
    const value: PanelNav = { navigateTo: vi.fn(), pending: '/panel/productos' };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PanelNavContext.Provider value={value}>{children}</PanelNavContext.Provider>
    );
    const { result } = renderHook(() => usePanelNavPending(), { wrapper });
    expect(result.current).toBe('/panel/productos');
  });
});
