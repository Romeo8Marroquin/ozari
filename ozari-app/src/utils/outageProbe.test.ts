import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));
vi.mock('@utils/health', () => ({ checkHealth }));

import { useOutageStore } from '../stores/outageStore';
import { probeBackendMaybeOutage } from './outageProbe';

beforeEach(() => {
  checkHealth.mockReset();
  useOutageStore.setState({ active: false });
});

describe('probeBackendMaybeOutage', () => {
  it('raises the overlay when the confirming probe also fails', async () => {
    checkHealth.mockResolvedValue(false);
    await probeBackendMaybeOutage();
    expect(useOutageStore.getState().active).toBe(true);
  });

  it('does nothing when the probe succeeds (the failure was a one-off)', async () => {
    checkHealth.mockResolvedValue(true);
    await probeBackendMaybeOutage();
    expect(useOutageStore.getState().active).toBe(false);
  });

  it('is a no-op when the overlay is already up', async () => {
    useOutageStore.setState({ active: true });
    await probeBackendMaybeOutage();
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls into a single health round-trip', async () => {
    let release: (v: boolean) => void = () => {};
    checkHealth.mockImplementation(() => new Promise<boolean>((r) => (release = r)));

    const first = probeBackendMaybeOutage();
    const second = probeBackendMaybeOutage();
    release(true);
    await Promise.all([first, second]);

    expect(checkHealth).toHaveBeenCalledTimes(1);
  });
});
