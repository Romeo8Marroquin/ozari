import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type PanelMode = 'mobile' | 'tablet' | 'desktop';

interface PanelChrome {
  /** Current responsive bucket, derived from the viewport. */
  mode: PanelMode;
  /** Inline sidebar reduced to icons (tablet/desktop only). */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Mobile overlay drawer open. */
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

const PanelChromeContext = createContext<PanelChrome | null>(null);

const readMode = (): PanelMode => {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
};

// Per-device defaults: roomy on desktop, icons-only on tablet (where horizontal space is tighter).
const defaultCollapsed = (mode: PanelMode) => mode === 'tablet';

export const PanelChromeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<PanelMode>(readMode);
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(readMode()));
  const [mobileOpen, setMobileOpen] = useState(false);
  const modeRef = useRef(mode);

  // Re-apply each mode's default only when the breakpoint bucket actually changes — so a stray
  // resize (or the mobile keyboard) doesn't undo the user's manual collapse choice.
  useEffect(() => {
    const onResize = () => {
      const next = readMode();
      if (next === modeRef.current) return;
      modeRef.current = next;
      setMode(next);
      setCollapsed(defaultCollapsed(next));
      setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // While the mobile drawer is open: lock background scroll and let Escape close it.
  useEffect(() => {
    if (mode !== 'mobile' || !mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mode, mobileOpen]);

  const value = useMemo<PanelChrome>(
    () => ({
      mode,
      collapsed,
      toggleCollapsed: () => setCollapsed((current) => !current),
      mobileOpen,
      openMobile: () => setMobileOpen(true),
      closeMobile: () => setMobileOpen(false),
    }),
    [mode, collapsed, mobileOpen],
  );

  return <PanelChromeContext.Provider value={value}>{children}</PanelChromeContext.Provider>;
};

export const usePanelChrome = (): PanelChrome => {
  const context = useContext(PanelChromeContext);
  if (!context) throw new Error('usePanelChrome must be used within a PanelChromeProvider');
  return context;
};
