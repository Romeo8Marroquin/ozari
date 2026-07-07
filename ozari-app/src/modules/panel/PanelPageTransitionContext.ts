import { createContext, useContext, useLayoutEffect, useRef } from 'react';

/** A page's exit animation: play it, resolve when done so the layout can navigate/hand off after. */
export type PanelExitAnimation = () => Promise<void>;

/**
 * Lets a panel page register a CUSTOM exit animation with `PanelLayout`. The layout plays it before
 * navigating away (tab change) or logging out, so a page leaves the same way no matter what triggers
 * it. Registering also tells the layout the page owns its own ENTRANCE (run on mount), so the layout
 * skips its default body transition for that page. Pages that register nothing get the default.
 */
export const PanelPageTransitionContext = createContext<(exit: PanelExitAnimation | null) => void>(() => {});

/**
 * Register this page's exit animation for its whole mounted lifetime (cleared on unmount). The page
 * is then responsible for its own entrance too — run it in a layout effect / `useGSAP` on mount, so
 * it plays whenever the page appears (fresh load or tab change). The registered wrapper reads the
 * latest `exit` via a ref, so an inline function is fine — it won't re-register every render.
 */
export const usePanelPageExit = (exit: PanelExitAnimation): void => {
  const register = useContext(PanelPageTransitionContext);
  const exitRef = useRef(exit);
  // Keep the ref pointed at the latest `exit` (in an effect, never during render).
  useLayoutEffect(() => {
    exitRef.current = exit;
  });
  // Register a stable wrapper once (it reads the latest exit via the ref), cleared on unmount.
  useLayoutEffect(() => {
    register(() => exitRef.current());
    return () => register(null);
  }, [register]);
};
