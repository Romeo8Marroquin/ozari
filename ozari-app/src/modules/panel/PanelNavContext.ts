import { createContext, useContext } from 'react';
import type { PanelPath } from './navConfig';

/**
 * Navigate to another panel tab *through the panel's body transition*: the current screen animates
 * out first, then the route changes and the incoming screen plays its own mount-in — the same
 * exit→enter hand-off the logout→login flow uses, but scoped to the content body (the sidebar and
 * header stay put). Provided by `PanelLayout`; consumed by the sidebar links, brand, and header
 * menu so the *navigation* is the trigger, not each individual control.
 *
 * The transition is INTERRUPTIBLE — latest intent wins. Clicking mid-transition never blocks or
 * queues: a different target retargets the in-flight exit, and re-clicking the current tab cancels
 * it (the content settles back in from the current frame). `pending` publishes the in-flight
 * destination (null when idle) so the chrome can follow the intent live — the sidebar glides its
 * active pill to `pending` immediately and back home if the move is cancelled.
 *
 * Defaults to a no-op outside the panel. Kept in its own module so provider and consumers don't
 * form an import cycle (mirrors `PanelExitContext`).
 */
export interface PanelNav {
  navigateTo: (to: PanelPath) => void;
  /** The in-flight destination while a transition runs, else null. */
  pending: PanelPath | null;
}

export const PanelNavContext = createContext<PanelNav>({ navigateTo: () => {}, pending: null });

export const usePanelNavigate = (): ((to: PanelPath) => void) => useContext(PanelNavContext).navigateTo;

export const usePanelNavPending = (): PanelPath | null => useContext(PanelNavContext).pending;
