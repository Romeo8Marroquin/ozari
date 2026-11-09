import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { PRODUCT_MAX_QUANTITY } from '@constants/Regex';
import { Role } from '@constants/Roles';
import { getStoredUserId, useHasRole } from '@hooks/useRole';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Product } from '../products/product.types';
import { hasVariants, picksForVariant, poolKeyOf, stockKey, variantFor } from '../products/productVariations';
import type { OrderAvailabilityResponse } from './order.types';
import { isRentalProduct } from './orderEstimate';
import {
  clearOrderDraft,
  isMeaningfulOrderDraft,
  orderDraftText,
  readOrderDraft,
  saveOrderDraft,
  subscribeOrderDraft,
} from './orderDraft';
import {
  availabilityMapFrom,
  createOrderDefaultValues,
  parseDateTime,
  parseLineQuantity,
  takeableFor,
  type CreateOrderFormType,
} from './SchemaCreateOrder';

/**
 * THE ORDER SKETCH — the admin's cart (owner, 2026-11-09).
 *
 * There is no separate cart: the cart IS the order create form's draft (`orderDraft.ts`), one at a
 * time, kept on this device in localStorage. The product grid and the product detail page add LINES to
 * it, the header button counts them, and opening the button lands on `/panel/pedidos/nuevo` with the
 * sketch loaded — so the form and the cart can never disagree, because they are the same object. The
 * API is only called when the order is created (plus the availability probe below, which reads).
 *
 * A line is the form's own line (`productId`, `variantId`, `pickedValues`, `quantity`, `isRental`):
 * - a product WITHOUT variations is one line, `(product, null)`;
 * - a product with variations is added either AS A VARIATION (`(product, variant)`, from the detail page
 *   once every option is picked) or GENERIC (`(product, null)` + whatever picks were made — the grid,
 *   or the detail page before choosing): the form then asks for the variation, exactly as it does for
 *   a line the admin started there. A product offering exactly ONE variation is added as that one —
 *   there is nothing to choose.
 *
 * Every cap here is ADVISORY, like the form's: the create re-checks under the lock.
 */

export type SketchLine = CreateOrderFormType['lines'][number];

/** What a PRISTINE create form holds — the yardstick for "is there anything to keep" and the base a
 *  first add starts from. Shared with the form, so a cart started on the grid and a form opened
 *  empty are the very same blank order (the assignee defaults to the signed-in admin). */
export function pristineOrderValues(): CreateOrderFormType {
  return { ...createOrderDefaultValues, assignedUserId: getStoredUserId() as unknown as number };
}

// ── The store ───────────────────────────────────────────────────────────────────────────────────

let cache: { text: string | null; sketch: CreateOrderFormType | null } = { text: null, sketch: null };

/** The parsed sketch, cached by its stored TEXT — `useSyncExternalStore` demands a stable snapshot,
 *  and equal text is the same sketch, so subscribers re-render only on a real change. */
function snapshot(): CreateOrderFormType | null {
  const text = orderDraftText();
  if (text !== cache.text) cache = { text, sketch: text === null ? null : readOrderDraft() };
  return cache.sketch;
}

/** The live sketch (`null` = none). Follows the form keystroke by keystroke and other tabs too. */
export function useOrderSketch(): CreateOrderFormType | null {
  return useSyncExternalStore(subscribeOrderDraft, snapshot);
}

/** The lines that NAME a product — a blank row the admin added in the form is not something in the
 *  cart yet. */
export const sketchLines = (sketch: CreateOrderFormType | null): SketchLine[] =>
  (sketch?.lines ?? []).filter((line) => line.productId != null);

/** What the header counts: one per line (two colours of a tablecloth are two things in the cart). */
export const sketchCount = (sketch: CreateOrderFormType | null): number => sketchLines(sketch).length;

/** A line's quantity as a number — `0` for a blank or invalid one (the form shows why). */
export const lineQuantity = (line: SketchLine | undefined): number =>
  line ? (parseLineQuantity(line.quantity) ?? 0) : 0;

const sameLine = (line: SketchLine, productId: number, variantId: number | null): boolean =>
  line.productId === productId && (line.variantId ?? null) === variantId;

/** The sketch's line for this PAIR (`variantId: null` = the product's generic line), if any. */
export const findSketchLine = (
  sketch: CreateOrderFormType | null,
  productId: number,
  variantId: number | null,
): SketchLine | undefined => sketch?.lines.find((line) => sameLine(line, productId, variantId));

/** Writes new lines over the current sketch (or a pristine one) — and forgets the sketch entirely
 *  when nothing is left in it, so an emptied cart leaves no residue and the header empties. */
function writeLines(update: (lines: SketchLine[]) => SketchLine[]): void {
  const base = readOrderDraft() ?? pristineOrderValues();
  const next = { ...base, lines: update(base.lines) };
  if (isMeaningfulOrderDraft(next, pristineOrderValues())) saveOrderDraft(next);
  else clearOrderDraft();
}

/** The pair a GENERIC add of `product` really means: its only variation when it offers exactly one
 *  (nothing to choose), else the product itself. */
export function genericTarget(product: Product): { variantId: number | null; pickedValues: (number | null)[] } {
  const only = product.variants?.length === 1 ? product.variants[0] : undefined;
  if (only) return { variantId: only.id, pickedValues: picksForVariant(product, only) };
  return { variantId: null, pickedValues: [] };
}

/**
 * Adds ONE unit of `(product, variantId)` — a new line at quantity 1, or one more on the line that
 * already holds the pair — never past `cap` (`undefined` = unknown, so unbounded here; the form and
 * the server still hold the line). `pickedValues` are the partial picks a generic line carries.
 * Returns the line's new quantity (`0` = nothing could be added).
 */
export function addToSketch(
  product: Product,
  variantId: number | null,
  pickedValues: readonly (number | null)[],
  cap: number | undefined,
): number {
  const limit = Math.min(cap ?? PRODUCT_MAX_QUANTITY, PRODUCT_MAX_QUANTITY);
  const existing = findSketchLine(readOrderDraft(), product.id, variantId);
  const next = Math.min(lineQuantity(existing) + 1, limit);
  if (next <= lineQuantity(existing)) return lineQuantity(existing);
  if (existing) {
    setSketchQuantity(product.id, variantId, next);
    return next;
  }
  const variant = variantFor(product, variantId);
  writeLines((lines) => [
    ...lines,
    {
      productId: product.id,
      variantId: variant ? variant.id : null,
      pickedValues: variant ? picksForVariant(product, variant) : [...pickedValues],
      quantity: String(next),
      isRental: isRentalProduct(product),
    },
  ]);
  return next;
}

/** Sets the pair's quantity; `0` (or less) takes the line out of the sketch. */
export function setSketchQuantity(productId: number, variantId: number | null, quantity: number): void {
  const index = (readOrderDraft()?.lines ?? []).findIndex((line) => sameLine(line, productId, variantId));
  if (index === -1) return;
  writeLines((lines) =>
    quantity <= 0
      ? lines.filter((_, at) => at !== index)
      : lines.map((line, at) =>
          at === index ? { ...line, quantity: String(Math.min(quantity, PRODUCT_MAX_QUANTITY)) } : line,
        ),
  );
}

/**
 * How many of `(product, variantId)` the sketch may hold IN TOTAL — the takeable amount (the window
 * figure once the sketch is dated, else today's stock) less what the sketch's OTHER lines of the same
 * product already take from the same units. `undefined` = unknown (left to the form and the server).
 *
 * - A GENERIC line (`variantId: null`) will become some variation, so it draws on the whole product:
 *   every other line of the product counts against it.
 * - A VARIATION line draws on its own units (the shared pool, with `sharedStock`) — and a generic line
 *   of the same product counts against it too, since it may yet become this one — and never past what
 *   the product as a whole has left.
 */
export function sketchLineCap(
  product: Product,
  variantId: number | null,
  lines: readonly SketchLine[],
  availability: Map<string, number | null>,
): number | undefined {
  const products = new Map([[product.id, product]]);
  const own = takeableFor(product.id, variantId, availability, products);
  if (own === undefined) return undefined;
  const ownIndex = lines.findIndex((line) => sameLine(line, product.id, variantId));
  const others = lines.filter((line, at) => at !== ownIndex && line.productId === product.id);
  const used = (filter: (line: SketchLine) => boolean): number =>
    others.filter(filter).reduce((sum, line) => sum + lineQuantity(line), 0);
  const productUsed = used(() => true);
  if (variantId == null) return Math.max(0, own - productUsed);
  const pool = poolKeyOf(product, product.id, variantId);
  const poolUsed = used(
    (line) => line.variantId == null || poolKeyOf(product, product.id, line.variantId) === pool,
  );
  const whole = takeableFor(product.id, null, availability, products);
  const byPool = own - poolUsed;
  return Math.max(0, whole === undefined ? byPool : Math.min(byPool, whole - productUsed));
}

// ── Availability for the sketch's window ───────────────────────────────────────────────────────────

/** The API's own ceiling on one probe. */
const MAX_PROBE_PRODUCTS = 200;
const NO_AVAILABILITY = new Map<string, number | null>();

/** The sketch's window, once it has a usable delivery date (a pickup is optional — a sale has none). */
export function sketchWindow(
  sketch: CreateOrderFormType | null,
): { deliveryAt: Date; pickupAt: Date | null } | null {
  const deliveryAt = sketch ? parseDateTime(sketch.deliveryAt) : null;
  if (!sketch || !deliveryAt) return null;
  return { deliveryAt, pickupAt: parseDateTime(sketch.pickupAt) };
}

/**
 * What `productIds` can still take in the SKETCH's window — the same `POST /orders/availability` the
 * form asks, so the grid, the detail page and the form's picker all speak for the same dates. Empty
 * (today's stock stands) until the sketch has a delivery date, for anybody but an Admin (the probe is
 * theirs, and so is the cart), and when the probe fails: availability is ADVISORY, so a failure stays
 * silent (`skipErrorNotification`) and the create still re-checks under the lock.
 */
export function useSketchAvailability(productIds: readonly number[]): {
  availability: Map<string, number | null>;
  window: { deliveryAt: Date; pickupAt: Date | null } | null;
} {
  const isAdmin = useHasRole([Role.Admin]);
  const span = sketchWindow(useOrderSketch());
  const ids = [...new Set(productIds)].sort((a, b) => a - b).slice(0, MAX_PROBE_PRODUCTS);
  const deliveryAt = span?.deliveryAt.toISOString();
  const pickupAt = span?.pickupAt?.toISOString();
  const query = useQuery({
    queryKey: [QueryKeys.SKETCH_AVAILABILITY, deliveryAt, pickupAt, ids],
    queryFn: async () => {
      const response = await api.post<OzariSuccessResponse<OrderAvailabilityResponse>>(
        '/orders/availability',
        { deliveryAt, ...(pickupAt && { pickupAt }), productIds: ids },
        { skipErrorNotification: true },
      );
      return availabilityMapFrom(response.data.data?.availability ?? []);
    },
    enabled: isAdmin && deliveryAt !== undefined && ids.length > 0,
    retry: false,
    staleTime: 30 * 1000,
    // While a NEW question is in flight (other dates, another page of products), keep answering
    // with the last window's figures: dropping to today's stock for a moment and then to the new
    // window would flash every chip twice. Figures the previous answer did not cover stay today's
    // until theirs lands — and each chip cross-fades to its new value either way.
    placeholderData: keepPreviousData,
  });
  return {
    availability: (isAdmin && span && query.data) || NO_AVAILABILITY,
    window: isAdmin ? span : null,
  };
}

/**
 * `product` as the sketch's window sees it: its own and each variation's `available` (and `inStock`)
 * replaced by the window's figure wherever the probe answered — so the stock chip, the sold-out
 * swatches and every cap read the dates the admin is booking for, through the fields they already
 * read. Only the Admin projection carries those fields, and only they are touched; everything else
 * (photos, prices) is the very same object, so nothing downstream re-keys.
 */
export function withWindowStock(product: Product, availability: Map<string, number | null>): Product {
  if (availability.size === 0 || product.available === undefined) return product;
  const own = availability.get(stockKey(product.id));
  const variants = hasVariants(product)
    ? product.variants?.map((variant) => {
        const windowed = availability.get(stockKey(product.id, variant.id));
        return windowed == null ? variant : { ...variant, available: windowed, inStock: windowed > 0 };
      })
    : product.variants;
  return {
    ...product,
    ...(own != null && { available: own, inStock: own > 0 }),
    variants,
  };
}
