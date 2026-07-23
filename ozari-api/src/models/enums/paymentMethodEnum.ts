/**
 * Seeded `payment_methods` rows (see `prisma/seed.ts` — ids are fixed by the seed). HOW an order is
 * paid: Efectivo / Transferencia for now (owner 2026-07-23). The card door stays open — a future
 * method is a new seed row, no code change here. Chosen per order (a nullable snapshot on
 * `services`) and optionally the client's preferred default on `client_registries`.
 */
export enum PaymentMethodEnum {
  EFECTIVO = 1,
  TRANSFERENCIA,
}
