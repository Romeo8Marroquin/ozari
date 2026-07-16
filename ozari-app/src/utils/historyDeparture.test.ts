import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHistoryDepartureHold,
  installHistoryDepartureInterceptor,
  setHistoryDepartureHold,
} from './historyDeparture';

/** A stand-in for the ROUTER's popstate listener — registered AFTER the interceptor, like main.tsx. */
const routerListener = vi.fn();

const firePopstate = (): void => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: { key: 'k' } }));
};

beforeEach(() => {
  installHistoryDepartureInterceptor(); // idempotent — one listener no matter how many suites run
  window.addEventListener('popstate', routerListener);
});
afterEach(() => {
  window.removeEventListener('popstate', routerListener);
  vi.clearAllMocks();
});

describe('historyDeparture', () => {
  it('passes popstates straight through when no hold is registered', () => {
    firePopstate();
    expect(routerListener).toHaveBeenCalledTimes(1);
  });

  it('passes through when the hold DECLINES (returns null)', () => {
    const hold = vi.fn().mockReturnValue(null);
    setHistoryDepartureHold(hold);
    firePopstate();
    expect(hold).toHaveBeenCalledWith(window.location.pathname);
    expect(routerListener).toHaveBeenCalledTimes(1);
    clearHistoryDepartureHold(hold);
  });

  it('HOLDS the event (router sees nothing) and re-dispatches it ONCE after the hold resolves', async () => {
    let resolveHold!: () => void;
    const pending = new Promise<void>((resolve) => (resolveHold = resolve));
    const hold = vi.fn().mockReturnValueOnce(pending).mockReturnValue(null);
    setHistoryDepartureHold(hold);

    firePopstate();
    expect(routerListener).not.toHaveBeenCalled(); // stopped before the router's listener

    resolveHold();
    await pending;
    await Promise.resolve(); // the .finally() re-dispatch tick
    expect(routerListener).toHaveBeenCalledTimes(1); // exactly one commit — no rollback blink
    // The re-dispatched pass is the INTERCEPTOR's own event — the hold is never consulted for it.
    expect(hold).toHaveBeenCalledTimes(1);
    clearHistoryDepartureHold(hold);
  });

  it('never loops even when the hold would ACCEPT its own re-dispatch (imageless-hero regression)', async () => {
    // The real-world trigger: the detail page's hold guards its second pass with "the morph is in
    // flight by then" — but a lift-off can silently no-op (a hero with no photo, a stale return
    // rect after chained history backs), so the hold would hold AGAIN, stop the re-dispatch, and
    // loop forever: the router never commits and the faded-out page sits blank. The interceptor
    // must own the guarantee: its own re-dispatch flows to the router no matter what the hold says.
    const hold = vi.fn().mockImplementation(() => Promise.resolve());
    setHistoryDepartureHold(hold);

    firePopstate();
    await Promise.resolve(); // the resolved hold
    await Promise.resolve(); // the .finally() re-dispatch tick
    expect(routerListener).toHaveBeenCalledTimes(1); // committed — no loop
    expect(hold).toHaveBeenCalledTimes(1); // consulted only for the REAL popstate

    // And the interceptor is re-armed for the next real navigation (the flag never leaks).
    firePopstate();
    expect(hold).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve(); // flush this pass's re-dispatch too, so nothing leaks past the test
    expect(routerListener).toHaveBeenCalledTimes(2);
    clearHistoryDepartureHold(hold);
  });

  it('clears by IDENTITY — an old page never clobbers its successor’s hold', () => {
    const successor = vi.fn().mockReturnValue(null);
    const old = vi.fn().mockReturnValue(null);
    setHistoryDepartureHold(successor);
    clearHistoryDepartureHold(old); // someone else's — must be ignored
    firePopstate();
    expect(successor).toHaveBeenCalled();
    clearHistoryDepartureHold(successor);
    firePopstate();
    expect(successor).toHaveBeenCalledTimes(1); // really cleared now
  });
});
