/**
 * The session-lifecycle **bridge**.
 *
 * The problem it solves: our forced-logout choreography (fade the panel out, navigate to login,
 * clear the query cache) lives in **React** — it needs `useNavigate`, `useQueryClient` and the
 * panel's `usePanelExit`. But the axios interceptor and the proactive-refresh timer are plain
 * modules that can't call hooks. This file is the mailbox between the two worlds:
 *
 *   - Non-React callers (interceptor / refresh timer) call {@link requestForcedLogout} when the
 *     session is definitively dead and can't be refreshed.
 *   - A single React listener (mounted once inside the panel) registers via
 *     {@link setForcedLogoutHandler} and runs the real choreography.
 *
 * It's the same shape as the `notify` helper reaching the notification store from outside React.
 *
 * IMPORTANT: this bridge does NOT decide *when* to log out — the interceptor still owns token
 * refresh. The bridge only carries the "give up gracefully" signal, and guarantees it fires
 * **once** even when a burst of requests all 401 at the same time (the classic bug where five
 * concurrent 401s trigger five overlapping exit animations).
 */

/** Why the session ended. Only forced/involuntary reasons live here (manual logout isn't "forced"). */
export type ForcedLogoutReason = 'expired';

export type ForcedLogoutHandler = (reason: ForcedLogoutReason) => void | Promise<void>;

let handler: ForcedLogoutHandler | null = null;

/**
 * True from the moment a forced logout is requested until the teardown finishes. The single-flight
 * guard: a burst of concurrent 401s all funnel into one teardown. Reset by {@link resetForcedLogout}
 * once teardown completes (or on a fresh login) so a *later* session can force-logout too.
 */
let inFlight = false;

/**
 * Register the React handler that runs the real logout choreography. Returns an unsubscribe.
 * Mounted once by the panel (see `ForcedLogoutListener`). If a forced logout was requested while
 * no handler was registered, it's replayed immediately on registration so the signal is never lost.
 */
export function setForcedLogoutHandler(next: ForcedLogoutHandler): () => void {
  handler = next;
  // Replay a signal that arrived before the listener mounted (e.g. a route-guard refresh failed
  // right as the panel was mounting).
  if (inFlight) void next('expired');
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Ask the app to log the user out gracefully. Idempotent while a teardown is in flight. If no React
 * handler is registered (forced logout requested from outside the panel — rare), falls back to a
 * hard redirect so the user still lands on login with a clean slate.
 */
export function requestForcedLogout(reason: ForcedLogoutReason = 'expired'): void {
  if (inFlight) return;
  inFlight = true;

  if (handler) {
    void handler(reason);
  } else {
    fallback();
  }
}

/**
 * Re-arm the guard. Called when a teardown finishes and on a fresh login, so the *next* session is
 * able to force-logout again. Without this, only the first forced logout per page load would fire.
 */
export function resetForcedLogout(): void {
  inFlight = false;
}

/** Whether a forced logout is currently in progress (used to suppress duplicate error toasts). */
export function isForcedLogoutInFlight(): boolean {
  return inFlight;
}

/**
 * Last resort when no React listener is mounted (forced logout triggered outside the panel). We
 * can't play the panel exit here, so just clear and hard-redirect. Imported lazily to avoid a cycle
 * (`tokenRefresh` imports this module).
 */
function fallback(): void {
  void import('@utils/tokenRefresh').then(({ clearAuthState }) => {
    clearAuthState();
    window.location.replace('/sesion/inicio');
  });
}
