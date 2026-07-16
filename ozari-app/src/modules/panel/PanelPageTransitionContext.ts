import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { EnterOptions } from './pageMotion';

/**
 * A page's custom motion pair. `exit` plays the departure and resolves when done (so the layout can
 * navigate/hand off after — or immediately if it was cut by a retarget, see `pageMotion`). `enter`
 * replays the entrance; with `fromCurrent` it resumes from the current frame — the layout calls it
 * ONLY to settle the page back in after a CANCELLED exit (re-clicking the current tab mid-leave).
 */
export interface PanelPageMotion {
  enter: (options?: EnterOptions) => void;
  exit: () => Promise<void>;
}

/**
 * Lets a panel page register CUSTOM motion with `PanelLayout`. The layout plays `exit` before
 * navigating away (tab change) or logging out, so a page leaves the same way no matter what
 * triggers it. Registering also tells the layout the page owns its own ENTRANCE (played by the page
 * on mount), so the layout skips its default body transition for that page — `enter` is only
 * invoked by the layout to resume after a cancelled exit. Pages that register nothing get the
 * default whole-screen fade.
 */
export const PanelPageTransitionContext = createContext<(motion: PanelPageMotion | null) => void>(() => {});

/**
 * Register this page's motion for its whole mounted lifetime (cleared on unmount). The page is
 * responsible for playing its own entrance on mount — run it in a layout effect, so it plays
 * whenever the page appears (fresh load or tab change). The registered wrapper reads the latest
 * `motion` via a ref, so an inline object is fine — it won't re-register every render.
 */
export const usePanelPageMotion = (motion: PanelPageMotion): void => {
  const register = useContext(PanelPageTransitionContext);
  const motionRef = useRef(motion);
  // Keep the ref pointed at the latest `motion` (in an effect, never during render).
  useLayoutEffect(() => {
    motionRef.current = motion;
  });
  // Register a stable wrapper once (it reads the latest motion via the ref), cleared on unmount.
  useLayoutEffect(() => {
    register({
      enter: (options) => motionRef.current.enter(options),
      exit: () => motionRef.current.exit(),
    });
    return () => register(null);
  }, [register]);
};
