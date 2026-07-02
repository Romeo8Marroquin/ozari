import { api } from '@api/client';

/**
 * One probe of the backend health endpoint (`GET /api/health/check` → 200 healthy / 503 down).
 * Marked `_isHealthCheck` so the interceptor doesn't treat its own failures as a fresh outage or
 * toast them (it IS the outage probe). Resolves `true` only on a real 200.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await api.get('/health/check', {
      _isHealthCheck: true,
      skipErrorNotification: true,
      // Short, independent timeout: a dead backend should fail the probe fast, not hang the poll.
      timeout: 8000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
