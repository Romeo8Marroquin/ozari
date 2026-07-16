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
    // First pass holds; the re-dispatched event is declined (the real page declines it because
    // its lift-off is already in flight by then).
    const hold = vi.fn().mockReturnValueOnce(pending).mockReturnValue(null);
    setHistoryDepartureHold(hold);

    firePopstate();
    expect(routerListener).not.toHaveBeenCalled(); // stopped before the router's listener

    resolveHold();
    await pending;
    await Promise.resolve(); // the .finally() re-dispatch tick
    expect(routerListener).toHaveBeenCalledTimes(1); // exactly one commit — no rollback blink
    expect(hold).toHaveBeenCalledTimes(2); // original + the re-dispatched pass (declined)
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
