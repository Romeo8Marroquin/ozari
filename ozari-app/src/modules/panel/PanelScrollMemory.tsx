import { useLocation } from '@tanstack/react-router';
import { useEffect, useLayoutEffect } from 'react';

/** Per-path scroll positions for the panel's single scroller. Module-level so it survives page
 *  remounts within a session; cleared when the panel unmounts (logout — positions are per-user). */
const memory = new Map<string, number>();


/** Imperative DOM positioning, deliberately OUTSIDE the component: the compiler's immutability
 *  analysis would otherwise read the prop-derived element's mutation as a prop write. */
function positionScroller(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

interface PanelScrollMemoryProps {
  /** The panel's scroll container (`main.panel-main` — the ONE scroller every page shares). */
  target: React.RefObject<HTMLElement | null>;
}

/**
 * **Every panel page owns its scroll position.** The panel has a single scroll container, so
 * without this, a page inherited whatever scroll the previous page left (submit at the bottom of
 * the product form → the grid opened scrolled down). This component:
 *
 *  - continuously records the scroller's position under the CURRENT pathname (passive listener);
 *  - on every route commit, restores the remembered position for the incoming path — or the top
 *    for a path never visited (fresh page = top + its own skeleton).
 *
 * It is rendered BEFORE the scroller in `PanelLayout`, which makes its layout effect run BEFORE
 * any page's own layout effects — so a page that must ALWAYS open at the top (the product detail's
 * `scrollPanelToTop`, load-bearing for the image-morph landing rect) simply overrides it
 * afterwards and wins, deliberately. New pages need NOTHING: remembered-or-top is automatic.
 */
const PanelScrollMemory: React.FC<PanelScrollMemoryProps> = ({ target }) => {
  const pathname = useLocation({ select: (location) => location.pathname });

  // One per-path effect: restore BEFORE paint, then record this path continuously (the last event
  // before a departure IS the position to come back to). React removes the previous path's
  // listener before this runs, so the restore's own async scroll event is recorded — harmlessly —
  // under the INCOMING path, never over the outgoing one's saved position.
  useLayoutEffect(() => {
    const el = target.current;
    /* v8 ignore next -- refs attach before layout effects; the guard is defensive */
    if (!el) return;
    positionScroller(el, memory.get(pathname) ?? 0);
    const record = (): void => {
      memory.set(pathname, el.scrollTop);
    };
    el.addEventListener('scroll', record, { passive: true });
    return () => el.removeEventListener('scroll', record);
  }, [pathname, target]);

  // Positions are per-user state: leaving the panel (logout) forgets them.
  useEffect(() => () => memory.clear(), []);

  return null;
};

export default PanelScrollMemory;
