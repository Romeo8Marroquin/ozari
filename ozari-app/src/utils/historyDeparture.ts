/**
 * Choreographed HISTORY departures (browser/device back/forward). A page can register a "hold":
 * when a popstate arrives, the hold may return a promise — the event is then stopped BEFORE the
 * router's own popstate listener sees it, the page plays its exit choreography, and the SAME
 * event is re-dispatched once the hold resolves, so the router commits exactly once, afterwards.
 *
 * This exists because the router-blocker route was tried and rejected: a blocker cannot actually
 * hold a popstate — it ROLLS the history back, evaluates, and RE-APPLIES the navigation, which
 * commits the destination twice (mount → entrance → unmount → remount → entrance = a visible
 * blink of the arriving page). Intercepting the raw event holds it for real: one commit.
 *
 * Ordering contract: `installHistoryDepartureInterceptor()` MUST run before the router is created
 * (listener registration order = firing order — ours has to fire first to stop propagation), and
 * before any other popstate listener that should apply to the eventual commit (main.tsx keeps
 * this order). The re-dispatched event is marked by the interceptor itself and flows straight
 * through to the router — the hold is NOT consulted again for it (see `redispatching` below).
 */

type DepartureHold = (nextPathname: string) => Promise<void> | null;

let activeHold: DepartureHold | null = null;
let installed = false;
// True exactly while our own re-dispatched event (below) is being delivered. The interceptor —
// not the hold — owns the one-commit guarantee: an earlier design let the second pass reach the
// hold and trusted it to decline "because its lift-off is already in flight", but any hold whose
// lift-off silently no-ops (a hero with no photo, a stale shared-element return rect after
// chained history backs) would ACCEPT its own re-dispatch, stopping it again and re-playing the
// exit forever — the router never committed and the faded-out page just sat there blank.
let redispatching = false;

/** Install the interceptor (idempotent). Call BEFORE `createRouter` — order is the contract. */
export function installHistoryDepartureInterceptor(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', (event) => {
    if (redispatching) {
      // Our own re-dispatch — let it flow to the router untouched. `dispatchEvent` is
      // synchronous, so the flag cannot leak onto an unrelated (real) popstate.
      redispatching = false;
      return;
    }
    const pending = activeHold?.(window.location.pathname) ?? null;
    if (!pending) return; // no hold, or the hold declined — the router handles it normally
    event.stopImmediatePropagation();
    void pending.finally(() => {
      // Same state, same URL — the router now processes the navigation exactly once.
      redispatching = true;
      window.dispatchEvent(new PopStateEvent('popstate', { state: event.state }));
    });
  });
}

/** Register the current page's departure hold (one at a time — the mounted page owns history). */
export function setHistoryDepartureHold(hold: DepartureHold): void {
  activeHold = hold;
}

/** Clear by identity, so an unmounting page never clobbers its successor's registration. */
export function clearHistoryDepartureHold(hold: DepartureHold): void {
  if (activeHold === hold) activeHold = null;
}
