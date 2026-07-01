import { createContext, useContext } from 'react';

/**
 * Plays the panel's coordinated exit animation and resolves when it's done. Provided by
 * `PanelLayout` and consumed by the logout flow, so the chrome can animate out (the mirror of its
 * entrance) before handing off to the login page. Defaults to a no-op resolved promise outside the
 * panel. Kept in its own module so provider and consumer don't form an import cycle.
 */
export const PanelExitContext = createContext<() => Promise<void>>(() => Promise.resolve());

export const usePanelExit = (): (() => Promise<void>) => useContext(PanelExitContext);
