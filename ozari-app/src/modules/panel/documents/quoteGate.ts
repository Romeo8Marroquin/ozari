import type { FieldPath } from 'react-hook-form';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';

/**
 * What the cotización's gate validates (owner, 2026-11-19: one product is enough for a quote).
 *
 * A quote does not require what the ORDER requires — a client, a venue, dates — because it is
 * usually asked for before any of them exist. It does guard everything it PRINTS: the lines (at
 * least one real product, with a valid quantity, its variation and the live availability caps), the
 * money, the billed days and the discount with its ceiling — and, once FILLED, the optional facts,
 * since a filled fact is printed and must be right.
 */

/** Always validated: what every quote prints. */
const ALWAYS: readonly FieldPath<CreateOrderFormType>[] = [
  'lines',
  'deliveryAmount',
  'depositAmount',
  'billedDays',
  'discountAmount',
  'discountReason',
];

/** Validated only once filled: empty, they are simply left off the page. */
const WHEN_FILLED = [
  'deliveryAt',
  'pickupAt',
  'deliveryName',
  'deliveryContact',
  'deliveryAddress',
] as const satisfies readonly FieldPath<CreateOrderFormType>[];

/** The fields the quote's gate validates for these values — handed to RHF's `trigger`, so a missing
 *  client or date stays quiet instead of lighting up as an error the quote does not have. */
export function quoteFields(values: CreateOrderFormType): FieldPath<CreateOrderFormType>[] {
  return [...ALWAYS, ...WHEN_FILLED.filter((field) => values[field].trim() !== '')];
}
