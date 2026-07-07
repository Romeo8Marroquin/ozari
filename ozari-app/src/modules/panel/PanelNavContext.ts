import { createContext, useContext } from 'react';
import type { PanelPath } from './navConfig';

/**
 * Navigate to another panel tab *through the panel's body transition*: the current screen fades
 * out first, then the route changes and the incoming screen plays its own mount-in — the same
 * exit→enter hand-off the logout→login flow uses, but scoped to the content body (the sidebar and
 * header stay put). Provided by `PanelLayout`; consumed by the sidebar links, brand, and header
 * menu so the *navigation* is the trigger, not each individual control.
 *
 * Defaults to a no-op outside the panel. Kept in its own module so provider and consumers don't
 * form an import cycle (mirrors `PanelExitContext`).
 */
export const PanelNavContext = createContext<(to: PanelPath) => void>(() => {});

export const usePanelNavigate = (): ((to: PanelPath) => void) => useContext(PanelNavContext);
