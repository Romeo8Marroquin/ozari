import { beforeEach, describe, expect, it } from 'vitest';
import { isOutageActive, reportOutage, useOutageStore } from './outageStore';

beforeEach(() => useOutageStore.setState({ active: false }));

describe('outageStore', () => {
  it('starts inactive', () => {
    expect(useOutageStore.getState().active).toBe(false);
    expect(isOutageActive()).toBe(false);
  });

  it('activate() raises the overlay', () => {
    useOutageStore.getState().activate();
    expect(useOutageStore.getState().active).toBe(true);
    expect(isOutageActive()).toBe(true);
  });

  it('reportOutage() is the imperative activate', () => {
    reportOutage();
    expect(isOutageActive()).toBe(true);
  });

  it('activate() is idempotent — no state object churn when already active', () => {
    useOutageStore.getState().activate();
    const first = useOutageStore.getState();
    first.activate();
    // Same state reference back (the `s.active ? s : …` guard), so subscribers don't re-fire.
    expect(useOutageStore.getState()).toBe(first);
  });

  it('deactivate() clears the overlay', () => {
    reportOutage();
    useOutageStore.getState().deactivate();
    expect(isOutageActive()).toBe(false);
  });
});
