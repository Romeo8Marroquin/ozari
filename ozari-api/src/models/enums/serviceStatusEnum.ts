/**
 * **SEED ANCHORS ONLY — never branch on these at runtime.** Since the order lifecycle became a
 * data-driven machine (EPIC-2 order lifecycle, 2026-07-27) the `service_status` ROWS declare their
 * own behavior (pipeline position, inventory hold, evidence rule, tracked actual, mode, colour) and
 * the admin may rename, recolor, reorder or add steps at will. Runtime logic must therefore read
 * those FLAGS through the lifecycle engine (`modules/orders/lifecycle/`), never a literal id.
 *
 * These constants exist so the SEED and the TESTS can name the default rows, and so the historical
 * ids stay documented:
 *   pipeline  PENDING(1) → EN_ROUTE(5) → DELIVERED(3) → COLLECTED(4) → READY(6)
 *   off-ramp  CANCELLED(2) — disruptive, reachable from any step
 *
 * (READY is the explicit "listo" press that ends the washing period and returns the units to the
 * fleet; COLLECTED still holds them because they are back but not yet clean.)
 */
export enum ServiceStatusEnum {
  PENDING = 1,
  CANCELLED,
  DELIVERED,
  COLLECTED,
  EN_ROUTE,
  READY,
}
