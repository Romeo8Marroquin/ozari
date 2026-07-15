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
 * this order). The re-dispatched event flows through every listener again; the hold naturally
 * declines the second pass (its work — e.g. the shared-element lift-off — is already in flight).
 */

type DepartureHold = (nextPathname: string) => Promise<void> | null;

let activeHold: DepartureHold | null = null;
let installed = false;

/** Install the interceptor (idempotent). Call BEFORE `createRouter` — order is the contract. */
export function installHistoryDepartureInterceptor(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', (event) => {
    const pending = activeHold?.(window.location.pathname) ?? null;
    if (!pending) return; // no hold, or the hold declined — the router handles it normally
    event.stopImmediatePropagation();
    void pending.finally(() => {
      // Same state, same URL — the router now processes the navigation exactly once.
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
