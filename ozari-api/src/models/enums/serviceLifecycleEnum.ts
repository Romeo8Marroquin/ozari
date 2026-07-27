/**
 * The declarative vocabulary of the ORDER LIFECYCLE machine (EPIC-2 order lifecycle, 2026-07-27).
 * These are the allowed values of the `service_status` capability columns — the machine is
 * configured in DATA, so these enums are the *validation* boundary (validators + the admin UI),
 * never a place to branch on a specific STATUS. Shared by the seed, the engine, and the validators.
 */

/**
 * How a RENTAL line sitting in a status affects fleet availability — the single expression of the
 * "is this unit takeable" rule:
 * - `NONE`   — available (Listo returned the units to the fleet; Cancelado never held them);
 * - `WINDOW` — held only while `now` falls inside the order's billed `[serviceStart, serviceEnd]`
 *              (Pendiente: a booking for next week must not reduce TODAY's count);
 * - `OUT`    — held unconditionally, however late: on the truck (En ruta), at the event (Entregado),
 *              or back but not yet washed (Recolectado — the washing period, owner 2026-07-27).
 */
export enum InventoryHoldEnum {
  NONE = "NONE",
  WINDOW = "WINDOW",
  OUT = "OUT",
}

/**
 * Which order MODES a pipeline step applies to — mode-aware completion, in data. A purchase-only
 * (SALE) order's pipeline ends at Entregado because collection/listo are `RENTAL` steps that simply
 * don't apply to it; no hardcoded sale-vs-rental branch exists anywhere in the engine.
 */
export enum StatusAppliesToEnum {
  ALL = "ALL",
  RENTAL = "RENTAL",
  SALE = "SALE",
}

/**
 * The tracked ACTUAL a step stamps on the order when it is entered (and clears when rewound).
 * Declared per status — never inferred from an id or a pipeline position, so an admin inserting
 * "En preparación" between two steps simply leaves it unset.
 */
export enum TrackedEventEnum {
  DELIVERY = "DELIVERY",
  COLLECTION = "COLLECTION",
}

/**
 * The fixed chip palette a status may pick its `colorKey` from. The DB stores the TOKEN only; the
 * frontend owns the class map (design stays in code) and renders an unknown/absent key as neutral.
 */
export const STATUS_COLOR_KEYS = [
  "amber",
  "indigo",
  "emerald",
  "sky",
  "violet",
  "rose",
  "red",
  "slate",
] as const;

export type StatusColorKey = (typeof STATUS_COLOR_KEYS)[number];
