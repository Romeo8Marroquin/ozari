/**
 * Seeded `service_status` rows (see `prisma/seed.ts` — ids are fixed by the seed). The order
 * lifecycle: PENDING (booked, holds its units only during the event window) → DELIVERED (units
 * physically out — they stay out until collected, however late) → COLLECTED (back in the
 * warehouse). CANCELLED never holds inventory.
 */
export enum ServiceStatusEnum {
  PENDING = 1,
  CANCELLED,
  DELIVERED,
  COLLECTED,
}
