/**
 * Seeded `service_status` rows (see `prisma/seed.ts` — ids are fixed by the seed). The order
 * lifecycle: PENDING (booked/confirmed, holds its units only during the event window) → EN_ROUTE
 * (loaded on the vehicle, on the way — Epic-2 tracking) → DELIVERED (units physically out — they
 * stay out until collected, however late) → COLLECTED (back in the warehouse; the explicit final
 * "listo" press, `services.ready_at`, returns the units to the fleet). CANCELLED never holds
 * inventory.
 *
 * NOTE (Epic-2 step 2, order tracking): `buildRentedNowWhere` in products.service.ts MUST count
 * EN_ROUTE as holding unconditionally (like DELIVERED) — the units are on the truck. Update it in
 * the same slice that starts writing EN_ROUTE.
 */
export enum ServiceStatusEnum {
  PENDING = 1,
  CANCELLED,
  DELIVERED,
  COLLECTED,
  EN_ROUTE,
}
