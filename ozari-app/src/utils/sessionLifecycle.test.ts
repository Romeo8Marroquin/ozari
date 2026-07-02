import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The no-handler fallback lazily imports tokenRefresh + hard-redirects. Mock the former; silence the
// jsdom "navigation not implemented" console noise from `location.replace`.
const { clearAuthState } = vi.hoisted(() => ({ clearAuthState: vi.fn() }));
vi.mock('@utils/tokenRefresh', () => ({ clearAuthState }));

import {
  isForcedLogoutInFlight,
  requestForcedLogout,
  resetForcedLogout,
  setForcedLogoutHandler,
} from './sessionLifecycle';

let unsubscribe: (() => void) | undefined;
const originalLocation = window.location;

// The fallback hard-redirects via `location.replace` inside an async dynamic import, which can
// resolve AFTER a given test ends — so hold the stub for the whole file (jsdom can't navigate).
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { replace: vi.fn(), assign: vi.fn(), href: 'http://localhost/', pathname: '/' },
  });
});
afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

beforeEach(() => clearAuthState.mockClear());

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  resetForcedLogout();
});

describe('sessionLifecycle', () => {
  it('invokes the registered handler once with the reason', () => {
    const handler = vi.fn();
    unsubscribe = setForcedLogoutHandler(handler);

    requestForcedLogout('expired');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('expired');
    expect(isForcedLogoutInFlight()).toBe(true);
  });

  it('single-flights a burst of requests into ONE teardown', () => {
    const handler = vi.fn();
    unsubscribe = setForcedLogoutHandler(handler);

    requestForcedLogout();
    requestForcedLogout();
    requestForcedLogout();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-arms after resetForcedLogout so a future session can tear down again', () => {
    const handler = vi.fn();
    unsubscribe = setForcedLogoutHandler(handler);

    requestForcedLogout();
    resetForcedLogout();
    requestForcedLogout();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('replays a request that arrived before the handler mounted', () => {
    requestForcedLogout(); // no handler yet → in-flight, fallback fires
    const handler = vi.fn();
    unsubscribe = setForcedLogoutHandler(handler);

    expect(handler).toHaveBeenCalledWith('expired');
  });

  it('unsubscribing removes the handler', () => {
    const handler = vi.fn();
    setForcedLogoutHandler(handler)(); // register then immediately unregister

    requestForcedLogout();

    expect(handler).not.toHaveBeenCalled();
  });

  it('with no handler, the fallback clears auth (and hard-redirects)', async () => {
    requestForcedLogout();
    await vi.waitFor(() => expect(clearAuthState).toHaveBeenCalledTimes(1));
  });
});
