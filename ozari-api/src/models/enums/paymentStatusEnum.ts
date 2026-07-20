/**
 * Seeded `payment_status` rows (see `prisma/seed.ts` — ids are fixed by the seed). Payment is an
 * order STATE, not a tracking step (owner decision): it can change at any moment, independently of
 * the delivery lifecycle. REFUNDED exists as a seeded door — refunds have never happened in the
 * business and no flow writes it yet.
 */
export enum PaymentStatusEnum {
  PENDING = 1,
  PAID,
  REFUNDED,
}
