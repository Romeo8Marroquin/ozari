import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelChromeProvider, usePanelChrome } from './usePanelChrome';

// The global setup installs a matchMedia that only matches `(prefers-reduced-motion: reduce)`, so
// readMode() sees no min-width match and reports 'mobile'. These tests drive the responsive bucket
// by swapping matchMedia to report the desktop/tablet/mobile min-width queries, then restore it.
const originalMatchMedia = window.matchMedia;

type Mode = 'mobile' | 'tablet' | 'desktop';

const setViewport = (mode: Mode): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? true
        : mode === 'desktop'
          ? query.includes('1024px') || query.includes('768px')
          : mode === 'tablet'
            ? query.includes('768px')
            : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const wrapper = ({ children }: { children: ReactNode }) => <PanelChromeProvider>{children}</PanelChromeProvider>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.body.style.overflow = '';
});

describe('usePanelChrome', () => {
  it('throws when used outside its provider', () => {
    // Silence the expected React error boundary noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePanelChrome())).toThrow('usePanelChrome must be used within a PanelChromeProvider');
    spy.mockRestore();
  });

  it('reports the desktop bucket and an expanded (not collapsed) default', () => {
    setViewport('desktop');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    expect(result.current.mode).toBe('desktop');
    expect(result.current.collapsed).toBe(false);
    expect(result.current.mobileOpen).toBe(false);
  });

  it('defaults to collapsed on tablet (tighter horizontal space)', () => {
    setViewport('tablet');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    expect(result.current.mode).toBe('tablet');
    expect(result.current.collapsed).toBe(true);
  });

  it('a stored collapse preference wins over the per-mode default', () => {
    Storage.set(StorageKeys.PANEL_SIDEBAR_COLLAPSED, false);
    setViewport('tablet'); // tablet default would be collapsed=true, but the stored `false` wins
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    expect(result.current.collapsed).toBe(false);
  });

  it('toggleCollapsed flips the state and persists it to Storage', () => {
    setViewport('desktop');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });

    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    expect(Storage.get<boolean>(StorageKeys.PANEL_SIDEBAR_COLLAPSED)).toBe(true);

    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(false);
    expect(Storage.get<boolean>(StorageKeys.PANEL_SIDEBAR_COLLAPSED)).toBe(false);
  });

  it('opens and closes the mobile drawer', () => {
    setViewport('mobile');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });

    act(() => result.current.openMobile());
    expect(result.current.mobileOpen).toBe(true);
    act(() => result.current.closeMobile());
    expect(result.current.mobileOpen).toBe(false);
  });

  it('re-applies the new mode default on a breakpoint change (no stored preference)', () => {
    setViewport('tablet');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    expect(result.current.collapsed).toBe(true);

    setViewport('desktop');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.mode).toBe('desktop');
    expect(result.current.collapsed).toBe(false); // fell back to desktop's default
  });

  it('keeps a stored collapse choice across a breakpoint change', () => {
    Storage.set(StorageKeys.PANEL_SIDEBAR_COLLAPSED, true);
    setViewport('desktop');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    expect(result.current.collapsed).toBe(true);

    setViewport('tablet');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.mode).toBe('tablet');
    expect(result.current.collapsed).toBe(true); // stored choice preserved, not reset to a default
  });

  it('ignores a resize that does not cross a breakpoint bucket', () => {
    setViewport('desktop');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });

    // Same bucket → early return, nothing changes.
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.mode).toBe('desktop');
  });

  it('closes the drawer and clears any mobileOpen when the bucket changes', () => {
    setViewport('mobile');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    act(() => result.current.openMobile());
    expect(result.current.mobileOpen).toBe(true);

    setViewport('desktop');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.mobileOpen).toBe(false);
  });

  it('locks background scroll while the mobile drawer is open and restores it on close', () => {
    setViewport('mobile');
    document.body.style.overflow = 'scroll'; // a prior value we expect to be restored
    const { result } = renderHook(() => usePanelChrome(), { wrapper });

    act(() => result.current.openMobile());
    expect(document.body.style.overflow).toBe('hidden');

    act(() => result.current.closeMobile());
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('closes the open mobile drawer on Escape (and ignores other keys)', () => {
    setViewport('mobile');
    const { result } = renderHook(() => usePanelChrome(), { wrapper });
    act(() => result.current.openMobile());

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    expect(result.current.mobileOpen).toBe(true); // non-Escape ignored

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.mobileOpen).toBe(false);
  });
});
