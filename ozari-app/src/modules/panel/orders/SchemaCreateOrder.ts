import {
  ORDER_ADDRESS_MIN_LENGTH,
  ORDER_LONGTEXT_MAX_LENGTH,
  ORDER_MAX_LINES,
  ORDER_TEXT_MAX_LENGTH,
  ORDER_TEXT_MIN_LENGTH,
  PRODUCT_MAX_AMOUNT,
  PRODUCT_MAX_QUANTITY,
} from '@constants/Regex';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.orders.create.errors';

/**
 * The order-creation MODE the fork asks first ("¿Rentar, comprar o ambos?"): it filters the
 * product picker and, together with which lines are actually rentals, decides whether a pickup
 * exists (Q-A). It is pure UI state — never sent; the backend derives everything from the lines.
 */
export type OrderMode = 'rent' | 'buy' | 'both';

/** The mode fork's option order (also the radiogroup's arrow-key order). */
export const ORDER_MODES: readonly OrderMode[] = ['rent', 'buy', 'both'];

/** Parses a MONEY text input: `''` = absent; else a non-negative number within the ceiling; `null`
 *  when present-but-invalid (the schema turns `null` into a field error). Mirrors the product form. */
export const parseMoney = (value: string): number | undefined | null => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > PRODUCT_MAX_AMOUNT) return null;
  return parsed;
};

/** Parses a per-line QUANTITY: a required integer within `[1, PRODUCT_MAX_QUANTITY]`. */
export const parseLineQuantity = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > PRODUCT_MAX_QUANTITY) return null;
  return parsed;
};

/** A datetime-local input value ('2026-08-01T14:00') → a Date, or `null` when unparseable/empty. */
export const parseDateTime = (value: string): Date | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const moneyField = (invalidMessage: string) =>
  z.string().refine((value) => parseMoney(value) !== null, invalidMessage);

const requiredText = (min: number, max: number, requiredMessage: string, invalidMessage: string) =>
  z
    .string()
    .trim()
    .nonempty(requiredMessage)
    .refine((value) => value.length >= min && value.length <= max, invalidMessage);

/**
 * Mirrors the backend create-order validator (`ozari-api/.../orders.validator.ts`): both sides must
 * accept/reject the same values — the backend is the security boundary, this is the UX mirror.
 * `isRental` rides on each line (set by the product picker from the catalog) so the pickup rule is
 * self-contained: a pickup is required exactly when the order carries a rental line, and forbidden
 * otherwise (Q-A). The admin has NO lead-time restriction (unlike a future client flow) — only the
 * pickup-after-delivery ordering. Numeric text inputs (quantity, money) stay strings and are parsed
 * here + on submit; selects hold numeric ids directly.
 */
const baseCreateOrderSchema = z.object({
  clientRegistryId: z.number({ error: t(`${KEY}.requiredClient`) }),
  eventTypeId: z.number({ error: t(`${KEY}.requiredEventType`) }),
  deliveryAt: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredDeliveryAt`))
    .refine((value) => parseDateTime(value) !== null, t(`${KEY}.invalidDeliveryAt`)),
  // Non-optional strings defaulting to '' (never undefined — the form always registers them): the
  // presence/ordering rule lives in the superRefine, which reads '' as "absent". Keeping these
  // non-optional means the watched values are plain strings, so the UI never optional-chains them.
  pickupAt: z.string(),
  deliveryName: requiredText(
    ORDER_TEXT_MIN_LENGTH,
    ORDER_TEXT_MAX_LENGTH,
    t(`${KEY}.requiredDeliveryName`),
    t(`${KEY}.invalidDeliveryName`),
  ),
  deliveryContact: requiredText(
    ORDER_TEXT_MIN_LENGTH,
    ORDER_TEXT_MAX_LENGTH,
    t(`${KEY}.requiredDeliveryContact`),
    t(`${KEY}.invalidDeliveryContact`),
  ),
  deliveryAddress: requiredText(
    ORDER_ADDRESS_MIN_LENGTH,
    ORDER_LONGTEXT_MAX_LENGTH,
    t(`${KEY}.requiredDeliveryAddress`),
    t(`${KEY}.invalidDeliveryAddress`),
  ),
  description: z
    .string()
    .refine((v) => v.trim().length <= ORDER_LONGTEXT_MAX_LENGTH, t(`${KEY}.invalidDescription`)),
  comment: z
    .string()
    .refine((v) => v.trim().length <= ORDER_LONGTEXT_MAX_LENGTH, t(`${KEY}.invalidComment`)),
  deliveryAmount: moneyField(t(`${KEY}.invalidDeliveryAmount`)),
  depositAmount: moneyField(t(`${KEY}.invalidDepositAmount`)),
  // `null` = the empty-selection sentinel: how it's paid is OPTIONAL (payment can settle later);
  // the select pre-fills from the client's preferred method. Never required.
  paymentMethodId: z.number().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.number({ error: t(`${KEY}.requiredLineProduct`) }),
        quantity: z
          .string()
          .refine((value) => parseLineQuantity(value) !== null, t(`${KEY}.invalidLineQuantity`)),
        // Set by the product picker from the catalog; drives the pickup rule, dropped on submit.
        isRental: z.boolean(),
      }),
    )
    .min(1, t(`${KEY}.requiredLines`))
    .max(ORDER_MAX_LINES, t(`${KEY}.tooManyLines`)),
});

export const createOrderSchema = baseCreateOrderSchema.superRefine((data, ctx) => {
  // No duplicate products in one order (mirrors the backend; the picker already hides picked ones).
  const seen = new Set<number>();
  data.lines.forEach((line, index) => {
    if (seen.has(line.productId)) {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'productId'], message: t(`${KEY}.duplicateLineProduct`) });
    }
    seen.add(line.productId);
  });

  // Pickup coherence (Q-A): required + after delivery when any rental line exists; forbidden else.
  const anyRental = data.lines.some((line) => line.isRental);
  const pickup = data.pickupAt.trim();
  if (anyRental) {
    const pickupDate = parseDateTime(pickup);
    if (pickup === '') {
      ctx.addIssue({ code: 'custom', path: ['pickupAt'], message: t(`${KEY}.requiredPickupAt`) });
    } else if (pickupDate === null) {
      ctx.addIssue({ code: 'custom', path: ['pickupAt'], message: t(`${KEY}.invalidPickupAt`) });
    } else {
      const deliveryDate = parseDateTime(data.deliveryAt);
      if (deliveryDate && pickupDate.getTime() <= deliveryDate.getTime()) {
        ctx.addIssue({ code: 'custom', path: ['pickupAt'], message: t(`${KEY}.pickupBeforeDelivery`) });
      }
    }
  }
  // A purchase-only order carries no pickup — the UI hides the field, so a value here is stale.
});

export type CreateOrderFormType = z.infer<typeof createOrderSchema>;

export const createOrderDefaultValues: CreateOrderFormType = {
  clientRegistryId: null as unknown as number, // null = the client select opens on its placeholder
  eventTypeId: null as unknown as number,
  deliveryAt: '',
  pickupAt: '',
  deliveryName: '',
  deliveryContact: '',
  deliveryAddress: '',
  description: '',
  comment: '',
  deliveryAmount: '',
  depositAmount: '',
  paymentMethodId: null,
  lines: [],
};

/** The `POST /orders` body — ISO dates, numbers where the API wants numbers, absent fields omitted. */
export interface CreateOrderBody {
  clientRegistryId: number;
  eventTypeId: number;
  deliveryAt: string;
  pickupAt?: string;
  deliveryName: string;
  deliveryContact: string;
  deliveryAddress: string;
  description?: string;
  comment?: string;
  deliveryAmount?: number;
  depositAmount?: number;
  paymentMethodId?: number;
  lines: { productId: number; quantity: number }[];
}

/** Maps the validated form values to the API body (money truncated to cents, like the backend). */
export function toCreateOrderBody(data: CreateOrderFormType): CreateOrderBody {
  const money = (value: string): number | undefined => {
    const parsed = parseMoney(value);
    return parsed === undefined || parsed === null ? undefined : Math.trunc(parsed * 100) / 100;
  };
  const anyRental = data.lines.some((line) => line.isRental);
  const description = data.description.trim();
  const comment = data.comment.trim();
  /* v8 ignore next -- parseDateTime is guaranteed non-null by the schema; the `?? new Date()` documents that */
  const deliveryAt = (parseDateTime(data.deliveryAt) ?? new Date()).toISOString();
  const pickup = anyRental ? parseDateTime(data.pickupAt) : null;
  return {
    clientRegistryId: data.clientRegistryId,
    eventTypeId: data.eventTypeId,
    deliveryAt,
    ...(pickup && { pickupAt: pickup.toISOString() }),
    deliveryName: data.deliveryName.trim(),
    deliveryContact: data.deliveryContact.trim(),
    deliveryAddress: data.deliveryAddress.trim(),
    ...(description && { description }),
    ...(comment && { comment }),
    ...(money(data.deliveryAmount) !== undefined && { deliveryAmount: money(data.deliveryAmount) }),
    ...(money(data.depositAmount) !== undefined && { depositAmount: money(data.depositAmount) }),
    ...(data.paymentMethodId != null && { paymentMethodId: data.paymentMethodId }),
    lines: data.lines.map((line) => ({
      productId: line.productId,
      /* v8 ignore next -- parseLineQuantity is guaranteed non-null by the schema */
      quantity: parseLineQuantity(line.quantity) ?? 1,
    })),
  };
}

export const createOrderRequiredPatterns = getZodRequiredPatterns(baseCreateOrderSchema);
