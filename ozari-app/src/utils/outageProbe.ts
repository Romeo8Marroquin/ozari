import { checkHealth } from '@utils/health';
import { isOutageActive, reportOutage } from '../stores/outageStore';

let probing = false;

/**
 * Confirms whether the backend is actually down after a **network error** (no HTTP response —
 * connection refused, DNS failure, timeout), which is how a dead/removed deployment fails rather
 * than a clean 502/503. We don't raise the outage overlay on the bare network error (it could be a
 * single flaky request); instead we probe `/health/check` once and only escalate if THAT also fails.
 *
 * Deduped (one probe at a time) and a no-op if the overlay is already up, so a burst of failing
 * requests triggers at most one confirmation round-trip.
 */
export async function probeBackendMaybeOutage(): Promise<void> {
  if (probing || isOutageActive()) return;
  probing = true;
  try {
    const healthy = await checkHealth();
    if (!healthy) reportOutage();
  } finally {
    probing = false;
  }
}
