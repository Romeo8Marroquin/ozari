import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoist-safe mock of the axios client (importing the real one would boot the whole interceptor stack).
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { checkHealth } from './health';

afterEach(() => get.mockReset());

describe('checkHealth', () => {
  it('resolves true on a 200', async () => {
    get.mockResolvedValue({ status: 200 });
    expect(await checkHealth()).toBe(true);
  });

  it('resolves false on a non-200 (e.g. 503 unhealthy)', async () => {
    get.mockResolvedValue({ status: 503 });
    expect(await checkHealth()).toBe(false);
  });

  it('resolves false when the request rejects (backend unreachable)', async () => {
    get.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await checkHealth()).toBe(false);
  });

  it('probes /health/check and flags itself exempt from the outage trigger + toasts', async () => {
    get.mockResolvedValue({ status: 200 });
    await checkHealth();
    expect(get).toHaveBeenCalledWith(
      '/health/check',
      expect.objectContaining({ _isHealthCheck: true, skipErrorNotification: true }),
    );
  });
});
