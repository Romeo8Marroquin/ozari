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
import type { ResolverResult } from 'react-hook-form';
import { z } from 'zod';
import type { DriverAvailability } from './order.types';

const KEY = 'modules.panel.orders.create.errors';

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

/**
 * Grace absorbed when checking the delivery isn't in the PAST: the picker is minute-granular and the
 * admin needs a moment to finish + submit, so a delivery chosen as "now" and saved seconds later
 * still passes. Mirrors the backend validator's `DELIVERY_PAST_GRACE_MS`.
 */
export const DELIVERY_PAST_GRACE_MS = 2 * 60 * 1000;

/**
 * The current local instant as a `datetime-local` value ('YYYY-MM-DDTHH:mm') — the delivery picker's
 * `min`, so the native calendar itself won't offer a past date (the schema + backend still guard it).
 */
export function nowDateTimeLocal(): string {
  const now = new Date(Date.now());
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

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
    .refine((value) => parseDateTime(value) !== null, t(`${KEY}.invalidDeliveryAt`))
    // Not in the past (mirrors the backend). Skipped when unparseable — the refine above owns that.
    .refine((value) => {
      const parsed = parseDateTime(value);
      return parsed === null || parsed.getTime() >= Date.now() - DELIVERY_PAST_GRACE_MS;
    }, t(`${KEY}.deliveryInPast`)),
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
  // FORM-ONLY (never sent): the delivery contact's channel drives the leading icon + keyboard, and
  // the delivery zone drives the fee SUGGESTION. Both default from the chosen client but are freely
  // editable; the snapshot the API stores is the contact TEXT + the (editable) delivery fee.
  deliveryContactTypeId: z.number().nullable(),
  deliveryZoneId: z.number().nullable(),
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
  // Who the order is assigned to — REQUIRED, exactly like the backend validator (Q-D2, owner
  // decision 2026-07-30: "unassigned" is deleted rather than modelled, because the logistics pad is
  // a rule about a DRIVER's day). The select defaults to the creating admin, so the form never
  // produces an unassigned order. The options are the catalog's `assignableUsers`.
  assignedUserId: z.number({ error: t(`${KEY}.requiredAssignee`) }),
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

/**
 * The EDIT schema — identical except that the delivery date is free (owner decision, 2026-07-29).
 * "Not in the past" is a rule about SCHEDULING something new; an order being corrected already
 * happened, or is being moved for a reason the admin knows and the form doesn't. The pickup rule is
 * untouched, so a rental's collection still has to come after its delivery whatever the date.
 * The backend's update validator drops the same guard — the two mirrors stay in step.
 */
const baseUpdateOrderSchema = baseCreateOrderSchema.extend({
  deliveryAt: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredDeliveryAt`))
    .refine((value) => parseDateTime(value) !== null, t(`${KEY}.invalidDeliveryAt`)),
});

/** The cross-field rules both schemas share (duplicate lines, pickup coherence). */
const orderCrossFieldRules = (
  data: z.infer<typeof baseCreateOrderSchema>,
  ctx: z.RefinementCtx,
): void => {
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
};

export const createOrderSchema = baseCreateOrderSchema.superRefine(orderCrossFieldRules);
export const updateOrderSchema = baseUpdateOrderSchema.superRefine(orderCrossFieldRules);

export type CreateOrderFormType = z.infer<typeof createOrderSchema>;

export const createOrderDefaultValues: CreateOrderFormType = {
  clientRegistryId: null as unknown as number, // null = the client select opens on its placeholder
  eventTypeId: null as unknown as number,
  deliveryAt: '',
  pickupAt: '',
  deliveryName: '',
  deliveryContact: '',
  deliveryContactTypeId: null,
  deliveryZoneId: null,
  deliveryAddress: '',
  description: '',
  comment: '',
  deliveryAmount: '',
  depositAmount: '',
  paymentMethodId: null,
  // null = unset; the form overrides it with the current admin's id (from the token) on mount.
  assignedUserId: null as unknown as number,
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
  assignedUserId: number;
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
    assignedUserId: data.assignedUserId,
    lines: data.lines.map((line) => ({
      productId: line.productId,
      /* v8 ignore next -- parseLineQuantity is guaranteed non-null by the schema */
      quantity: parseLineQuantity(line.quantity) ?? 1,
    })),
  };
}

/** An ISO instant → the `datetime-local` value ('YYYY-MM-DDTHH:mm') the pickers hold, in LOCAL time
 *  (the field has no timezone, and the order was scheduled in the business's own clock). */
export function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * An existing order → the form's values, for the EDIT page. The mirror of {@link toCreateOrderBody}:
 * every field the form owns is restored, so saving without touching anything sends exactly what is
 * already stored.
 *
 * Two fields are deliberately NOT restored — `deliveryContactTypeId` and `deliveryZoneId`. They are
 * form AIDS (they pick the contact icon/keyboard and suggest a delivery fee), never part of the
 * order: what an order records is the snapshot TEXT that was agreed. Reopening on the generic icon
 * with no zone pre-selected is honest; guessing them from the registry would silently rewrite the
 * agreed fee the moment a zone was chosen.
 */
export function orderToFormValues(order: {
  clientRegistryId?: number;
  eventType: { id: number };
  deliveryAt: string;
  pickupAt?: string;
  clientName: string;
  deliveryContact: string;
  deliveryAddress: string;
  description?: string;
  comment?: string;
  deliveryAmount?: number;
  depositAmount?: number;
  paymentMethod?: { id: number };
  assignee?: { id: number };
  lines: { productId: number; quantity: number; isRental: boolean }[];
}): CreateOrderFormType {
  return {
    ...createOrderDefaultValues,
    clientRegistryId: order.clientRegistryId as unknown as number,
    eventTypeId: order.eventType.id,
    deliveryAt: toDateTimeLocal(order.deliveryAt),
    pickupAt: order.pickupAt ? toDateTimeLocal(order.pickupAt) : '',
    deliveryName: order.clientName,
    deliveryContact: order.deliveryContact,
    deliveryAddress: order.deliveryAddress,
    description: order.description ?? '',
    comment: order.comment ?? '',
    deliveryAmount: order.deliveryAmount != null ? String(order.deliveryAmount) : '',
    depositAmount: order.depositAmount != null ? String(order.depositAmount) : '',
    paymentMethodId: order.paymentMethod?.id ?? null,
    assignedUserId: order.assignee?.id as unknown as number,
    lines: order.lines.map((line) => ({
      productId: line.productId,
      quantity: String(line.quantity),
      isRental: line.isRental,
    })),
  };
}

export const createOrderRequiredPatterns = getZodRequiredPatterns(baseCreateOrderSchema);

const RECONCILE_TOAST_BASE_MS = 6000;
const RECONCILE_TOAST_STEP_MS = 1600;
const RECONCILE_TOAST_MAX_MS = 15000;
/** The availability-reconciliation toast lists each changed product on its own line, so it lingers
 *  longer the more it carries — a generous base plus a step per row, capped so it never overstays. */
export const reconcileToastDuration = (changeCount: number): number =>
  Math.min(RECONCILE_TOAST_BASE_MS + changeCount * RECONCILE_TOAST_STEP_MS, RECONCILE_TOAST_MAX_MS);

/**
 * Resolves how many of a product the admin may still pick: the fetched per-WINDOW amount when it's
 * known (`POST /orders/availability`), else the product's current stock/fleet count (the pre-window
 * baseline, so the cap exists even before dates are set). `undefined` = unknown (the product isn't in
 * the probe and carries no baseline, or a rental with no pickup yet) → left to the server to guard.
 */
export function takeableFor(
  productId: number,
  windowAvailability: Map<number, number | null>,
  products: Map<number, { available?: number }>,
): number | undefined {
  const windowValue = windowAvailability.get(productId);
  if (windowValue != null) return windowValue;
  return products.get(productId)?.available;
}

// ── The logistics pad (driver availability) ──────────────────────────────────────────────────────

/** The i18n leaf a gap of `minutes` reads as — whole hours say "1 hora", anything else stays in
 *  minutes. Returned as `{ key, count }` so the caller interpolates with its own `t` (and the
 *  contract checker sees a real plural key). NEVER hardcode "1 hora": the admin can change it. */
export function gapLabelKey(minutes: number): { key: string; count: number } {
  return minutes > 0 && minutes % 60 === 0
    ? { key: 'gapHours', count: minutes / 60 }
    : { key: 'gapMinutes', count: minutes };
}

/**
 * The messages `appendDriverConflictErrors` needs. Both are FUNCTIONS OF THE ANSWER's own data —
 * each clash names its own moment, and the gap is whatever the admin configured — so the caller
 * memoizes them on `t` alone and never has to rebuild them per probe.
 */
export interface DriverConflictMessages {
  conflict: (driverName: string, at: string) => string;
  /** This order's own delivery and collection are too close together. */
  selfOverlap: (gapMinutes: number) => string;
}

/**
 * Layers the LIVE driver-availability answer onto the resolver result — the same shape as
 * {@link appendLineAvailabilityErrors}, and for the same reason: it must survive every
 * revalidation, which a `setError` would not.
 *
 * **Where it lands is the whole point.** A stock problem is about a LINE ("no hay unidades") and
 * belongs on that line's quantity; a driver problem is about the DATES ("no podemos estar ahí") and
 * belongs on the delivery / pickup inputs. `blocks` says which of the two events each conflict
 * hits, so the message appears on the field the admin has to change — never on both. A self-overlap
 * is about the pair, so it marks the pickup: that is the one the admin moves.
 *
 * Pure, and silent when there is nothing to say: an absent probe answer (never run, still in
 * flight, or failed) leaves the result untouched — availability is advisory and the save's 409 is
 * the real guard.
 */
export function appendDriverConflictErrors(
  driver: DriverAvailability | undefined,
  result: ResolverResult<CreateOrderFormType>,
  messages: DriverConflictMessages,
): ResolverResult<CreateOrderFormType> {
  if (!driver || driver.available) return result;
  const errors: Record<string, { type: string; message: string }> = {};
  if (driver.selfOverlap) {
    errors['pickupAt'] = {
      type: 'driver',
      message: messages.selfOverlap(driver.gapMinutes ?? 0),
    };
  }
  (driver.conflicts ?? []).forEach((conflict) => {
    const field = conflict.blocks === 'COLLECTION' ? 'pickupAt' : 'deliveryAt';
    // A field already carrying a message keeps it: the schema's own errors (and the self-overlap,
    // which is the more specific fault) are never overwritten by a later conflict.
    if (!errors[field] && !(result.errors as Record<string, unknown>)[field]) {
      errors[field] = {
        type: 'driver',
        message: messages.conflict(driver.driverName ?? '', conflict.at),
      };
    }
  });
  if (Object.keys(errors).length === 0) return result;
  return {
    values: {},
    errors: { ...result.errors, ...errors },
  } as ResolverResult<CreateOrderFormType>;
}

/**
 * Layers a LIVE availability cap on top of the mirrored schema result: any line whose quantity
 * exceeds what's takeable for the current window gets a `quantity` error, so the form blocks the same
 * over-stock the backend rejects with a 409 — but as the admin types, not only on submit. A schema
 * error already on a line is never overwritten, and an `undefined` cap (unknown window / rental with
 * no pickup) is left to the server. Pure: the resolver wrapper feeds it the live caps.
 */
export function appendLineAvailabilityErrors(
  values: CreateOrderFormType,
  result: ResolverResult<CreateOrderFormType>,
  capFor: (productId: number) => number | undefined,
  message: (available: number) => string,
): ResolverResult<CreateOrderFormType> {
  const baseLines = result.errors.lines as unknown as
    | ({ quantity?: unknown } | undefined)[]
    | undefined;
  const extra: Record<number, { type: string; message: string }> = {};
  values.lines.forEach((line, index) => {
    if (line.productId == null || baseLines?.[index]?.quantity) return;
    const cap = capFor(line.productId);
    const quantity = parseLineQuantity(line.quantity);
    if (cap != null && quantity != null && quantity > cap) {
      extra[index] = { type: 'availability', message: message(cap) };
    }
  });
  if (Object.keys(extra).length === 0) return result;
  // Rebuild `lines` as a sparse array carrying the schema's own line errors plus ours, so RHF resolves
  // `errors.lines[i].quantity` for the offending fields and treats the form as invalid (empty values).
  const lines: ({ quantity?: unknown } | undefined)[] = [];
  values.lines.forEach((_, index) => {
    const own = baseLines?.[index];
    const mine = extra[index];
    if (own || mine) lines[index] = { ...(own ?? {}), ...(mine ? { quantity: mine } : {}) };
  });
  return {
    values: {},
    errors: { ...result.errors, lines },
  } as ResolverResult<CreateOrderFormType>;
}
