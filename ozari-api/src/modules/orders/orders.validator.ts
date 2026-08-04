/* eslint-disable sonarjs/cognitive-complexity, complexity -- one linear pass over the create
   body, same shape as the products validator: each check rejects with its own key, order matters,
   splitting it would scatter the contract. */
import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RentTimeUnitEnum } from "@models/enums/rentTimeUnitEnum.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sanitizeCoords } from "@helpers/geo.js";
import {
  type CreateOrderLineRequestModel,
  type CreateOrderRequestModel,
} from "./orders.models.js";
import { ASSIGNABLE_ROLES } from "./orders.service.js";

/**
 * Grace absorbed when checking that a create delivery isn't in the PAST: the picker is minute-
 * granular and the admin needs a moment to finish + submit, so a delivery chosen as "now" and saved
 * a few seconds later must still pass. Mirrors the frontend schema's `DELIVERY_PAST_GRACE_MS`.
 */
const DELIVERY_PAST_GRACE_MS = 2 * 60 * 1000;

/** Rejects a malformed order body with its own key. Bound to the FLOW (`createOrder`/`updateOrder`)
 *  so the message and the operator log both name the operation that failed. */
type RejectOrderBody = (key: string, logParams: Record<string, unknown>) => void;

const rejectWith =
  (res: Response, scope: "createOrder" | "updateOrder"): RejectOrderBody =>
  (key, logParams) => {
    logger.warn(i18next.t(`orders.${scope}.validators.logs.${key}`, logParams));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t(`orders.${scope}.validators.${key}`),
    );
  };

/** A required snapshot/text field: trimmed, within `[min, max]`; `null` = invalid. */
const sanitizeText = (value: unknown, min: number, max: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
};

/** An OPTIONAL text field: absent stays absent; present must pass {@link sanitizeText}. */
const sanitizeOptionalText = (
  value: unknown,
  max: number,
): { ok: true; value: string | undefined } | { ok: false } => {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  const sanitized = sanitizeText(value, 1, max);
  return sanitized === null ? { ok: false } : { ok: true, value: sanitized };
};

/** Same optional-money stance as products: `[0, maxGlobalAmount]`, truncated to cents. */
const sanitizeOptionalMoney = (
  value: unknown,
): { ok: true; value: number | undefined } | { ok: false } => {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    value < 0 ||
    value > appConfig.maxGlobalAmount
  ) {
    return { ok: false };
  }
  return { ok: true, value: Math.trunc(value * 100) / 100 };
};

/** A date input (ISO string) → a valid `Date`, or `null`. */
const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * The whole order-body CONTRACT, shared by CREATE and UPDATE (they describe the same order, so a
 * rule may never exist in only one of them): identity (an ACTIVE client registry — the walk-in flow;
 * the platform-user variant is a documented door that widens THIS check, never a new endpoint), an
 * active event type, coherent logistics times (pickup required with any RENTAL line and after the
 * delivery; forbidden on a purchase-only order — Q-A), the snapshot texts, optional money fields,
 * and the lines (existing ACTIVE products, no duplicates, bounded quantities, one shared currency,
 * and rental units the day-based billing engine actually supports).
 *
 * Availability and spacing are deliberately NOT checked here — they're racy reads, so the
 * controllers re-derive them INSIDE their transaction under the product locks; this only guarantees
 * the request is well-formed. Returns `null` once it has already answered the request.
 *
 * `allowPastDelivery` (edit only) drops the not-in-the-past guard entirely — see the rule below.
 */
async function parseOrderBody(
  body: Record<string, unknown>,
  reject: RejectOrderBody,
  allowPastDelivery = false,
): Promise<CreateOrderRequestModel | null> {
  const prismaClient = await getPrismaClient();

  const clientRegistryId = body["clientRegistryId"];
  const registry =
    typeof clientRegistryId === "number" && Number.isInteger(clientRegistryId) && clientRegistryId >= 1
      ? await prismaClient.clientRegistry.findFirst({
          where: { id: clientRegistryId, isActive: true },
          select: { id: true },
        })
      : null;
  if (!registry) {
    reject("invalidClientRegistryId", { clientRegistryId });
    return null;
  }

  const eventTypeId = body["eventTypeId"];
  const eventType =
    typeof eventTypeId === "number" && Number.isInteger(eventTypeId) && eventTypeId >= 1
      ? await prismaClient.eventType.findFirst({
          where: { id: eventTypeId, isActive: true },
          select: { id: true },
        })
      : null;
  if (!eventType) {
    reject("invalidEventTypeId", { eventTypeId });
    return null;
  }

  const deliveryAt = parseDate(body["deliveryAt"]);
  if (!deliveryAt) {
    reject("invalidDeliveryAt", { deliveryAt: body["deliveryAt"] });
    return null;
  }
  // CREATING has no lead-time restriction for the admin (a future client flow will) — but a NEW
  // order may not be scheduled in the past. This is the ONE ordering guard on the date; the pickup
  // is then constrained to be after the delivery (below), so it inherits "not in the past" free.
  //
  // EDITING drops it entirely (owner decision, 2026-07-29): "not in the past" is a rule about
  // scheduling something NEW. An order being corrected already happened, or is being moved for a
  // reason the admin knows and the system doesn't — recording a delivery that ran yesterday, or
  // pulling a date back after a client rescheduled. The pickup rule still holds either way.
  if (!allowPastDelivery && deliveryAt.getTime() < Date.now() - DELIVERY_PAST_GRACE_MS) {
    reject("deliveryInPast", { deliveryAt: body["deliveryAt"] });
    return null;
  }

  // Lines: bounded, deduplicated, integer quantities within the global cap.
  const rawLines = body["lines"];
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    reject("invalidLines", { lines: rawLines });
    return null;
  }
  if (rawLines.length > appConfig.maxOrderLines) {
    reject("tooManyLines", { count: rawLines.length, max: appConfig.maxOrderLines });
    return null;
  }
  const seenProducts = new Set<number>();
  const lines: CreateOrderLineRequestModel[] = [];
  for (const rawLine of rawLines as Array<Record<string, unknown>>) {
    const productId = rawLine?.["productId"];
    const quantity = rawLine?.["quantity"];
    if (typeof productId !== "number" || !Number.isInteger(productId) || productId < 1) {
      reject("invalidLineProduct", { productId });
      return null;
    }
    if (seenProducts.has(productId)) {
      reject("duplicateLineProduct", { productId });
      return null;
    }
    seenProducts.add(productId);
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > appConfig.maxGlobalQuantity
    ) {
      reject("invalidLineQuantity", { productId, quantity });
      return null;
    }
    lines.push({ productId, quantity });
  }

  // Every line's product must be an ACTIVE catalog row; the products also decide the order's
  // MODE (any rental line ⇒ a pickup exists) and its currency (one per order).
  const products = await prismaClient.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) }, isActive: true },
    select: {
      id: true,
      currencyId: true,
      productBusinessTypeId: true,
      rentTimeUnitId: true,
      rentPrice: true,
      sellPrice: true,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) {
      reject("unknownLineProduct", { productId: line.productId });
      return null;
    }
    const isRental = product.productBusinessTypeId === BusinessTypeEnum.RENT;
    // Defensive: the catalog's conditional price rule guarantees these; a violating row must
    // fail loudly here rather than price a line at 0.
    if ((isRental ? product.rentPrice : product.sellPrice) === null) {
      reject("unknownLineProduct", { productId: line.productId });
      return null;
    }
    // The MVP billing engine is day-based: Día multiplies by billed days, Evento is flat.
    // Hora/Semana/Mes need real math of their own — reject loudly, never bill wrong (§2:
    // hourly is a live door, not silent behavior).
    if (
      isRental &&
      product.rentTimeUnitId !== RentTimeUnitEnum.Dia &&
      product.rentTimeUnitId !== RentTimeUnitEnum.Evento
    ) {
      reject("unsupportedRentTimeUnit", {
        productId: line.productId,
        rentTimeUnitId: product.rentTimeUnitId,
      });
      return null;
    }
  }
  const currencyIds = new Set(products.map((product) => product.currencyId));
  if (currencyIds.size > 1) {
    reject("mixedCurrencies", { currencyIds: [...currencyIds] });
    return null;
  }

  // Mode coherence (Q-A): any rental ⇒ pickup required and after delivery; purchase-only ⇒ no
  // pickup event at all.
  const anyRental = lines.some(
    (line) =>
      productById.get(line.productId)?.productBusinessTypeId === BusinessTypeEnum.RENT,
  );
  const rawPickupAt = body["pickupAt"];
  let pickupAt: Date | undefined;
  if (anyRental) {
    const parsed = parseDate(rawPickupAt);
    if (!parsed) {
      reject("pickupRequiredForRental", { pickupAt: rawPickupAt });
      return null;
    }
    if (parsed.getTime() <= deliveryAt.getTime()) {
      reject("pickupBeforeDelivery", { deliveryAt, pickupAt: parsed });
      return null;
    }
    pickupAt = parsed;
  } else if (rawPickupAt !== undefined && rawPickupAt !== null) {
    reject("pickupForbiddenForPurchase", { pickupAt: rawPickupAt });
    return null;
  }

  // The delivery snapshots — what the logistics actually use, captured as text (the snapshot
  // doctrine: prefilled from the registry or typed as a one-off venue, never a live FK).
  const deliveryName = sanitizeText(body["deliveryName"], 2, 255);
  if (deliveryName === null) {
    reject("invalidDeliveryName", { deliveryName: body["deliveryName"] });
    return null;
  }
  const deliveryContact = sanitizeText(body["deliveryContact"], 2, 255);
  if (deliveryContact === null) {
    reject("invalidDeliveryContact", { deliveryContact: body["deliveryContact"] });
    return null;
  }
  const deliveryAddress = sanitizeText(body["deliveryAddress"], 5, 500);
  if (deliveryAddress === null) {
    reject("invalidDeliveryAddress", { deliveryAddress: body["deliveryAddress"] });
    return null;
  }
  // The map pin — optional, and the TEXT above stays authoritative. Shared with the registry
  // validator through `sanitizeCoords`, so the two doors accept exactly the same values.
  const deliveryCoords = sanitizeCoords(body["deliveryCoords"]);
  if (!deliveryCoords.ok) {
    reject("invalidDeliveryCoords", { deliveryCoords: body["deliveryCoords"] });
    return null;
  }
  // How to get in on arrival — optional, and the only delivery field the DRIVER reads rather than
  // the admin. Prefilled from the client's address by the form, then freely edited per order.
  const deliveryInstructions = sanitizeOptionalText(body["deliveryInstructions"], 500);
  if (!deliveryInstructions.ok) {
    reject("invalidDeliveryInstructions", {
      deliveryInstructions: body["deliveryInstructions"],
    });
    return null;
  }

  const description = sanitizeOptionalText(body["description"], 500);
  if (!description.ok) {
    reject("invalidDescription", { description: body["description"] });
    return null;
  }
  const comment = sanitizeOptionalText(body["comment"], 500);
  if (!comment.ok) {
    reject("invalidComment", { comment: body["comment"] });
    return null;
  }
  const deliveryAmount = sanitizeOptionalMoney(body["deliveryAmount"]);
  if (!deliveryAmount.ok) {
    reject("invalidDeliveryAmount", { deliveryAmount: body["deliveryAmount"] });
    return null;
  }
  const depositAmount = sanitizeOptionalMoney(body["depositAmount"]);
  if (!depositAmount.ok) {
    reject("invalidDepositAmount", { depositAmount: body["depositAmount"] });
    return null;
  }

  // Payment method (optional — payment can be settled later): when present it must be an ACTIVE
  // seeded method.
  let paymentMethodId: number | undefined;
  const rawPaymentMethodId = body["paymentMethodId"];
  if (rawPaymentMethodId !== undefined && rawPaymentMethodId !== null) {
    const paymentMethod =
      typeof rawPaymentMethodId === "number" &&
      Number.isInteger(rawPaymentMethodId) &&
      rawPaymentMethodId >= 1
        ? await prismaClient.paymentMethod.findFirst({
            where: { id: rawPaymentMethodId, isActive: true },
            select: { id: true },
          })
        : null;
    if (!paymentMethod) {
      reject("invalidPaymentMethodId", { paymentMethodId: rawPaymentMethodId });
      return null;
    }
    paymentMethodId = rawPaymentMethodId as number;
  }

  // Assignment — **REQUIRED** (Q-D2, owner decision 2026-07-30). It used to be optional, with the
  // controller defaulting it to the creating admin: an unassigned order could not happen, but was
  // still a state the code had to reason about. The logistics pad is a rule about a DRIVER's day,
  // so every event needs an owner — requiring it here deletes the ambiguity instead of modelling
  // it. It must be an ACTIVE "deliverable" staff member; the role set is `ASSIGNABLE_ROLES`
  // (Admin + Driver today) — widen THERE to open assignment to new roles.
  const rawAssignedUserId = body["assignedUserId"];
  const assignedUser =
    typeof rawAssignedUserId === "number" &&
    Number.isInteger(rawAssignedUserId) &&
    rawAssignedUserId >= 1
      ? await prismaClient.user.findFirst({
          where: {
            id: rawAssignedUserId,
            isActive: true,
            roleId: { in: [...ASSIGNABLE_ROLES] },
          },
          select: { id: true },
        })
      : null;
  if (!assignedUser) {
    reject("invalidAssignedUserId", { assignedUserId: rawAssignedUserId });
    return null;
  }
  const assignedUserId = rawAssignedUserId as number;

  const validatedBody: CreateOrderRequestModel = {
    clientRegistryId: clientRegistryId as number,
    eventTypeId: eventTypeId as number,
    deliveryAt,
    pickupAt,
    deliveryName,
    deliveryContact,
    deliveryAddress,
    deliveryCoords: deliveryCoords.value,
    deliveryInstructions: deliveryInstructions.value,
    description: description.value,
    comment: comment.value,
    deliveryAmount: deliveryAmount.value,
    depositAmount: depositAmount.value,
    paymentMethodId,
    assignedUserId,
    lines,
  };
  return validatedBody;
}

/** Runs {@link parseOrderBody} for `scope` and answers the request itself on any failure — the two
 *  validators below are then just "which flow am I, and what extra context do I have". */
const runOrderBodyValidator = async (
  req: Request,
  res: Response,
  next: NextFunction,
  scope: "createOrder" | "updateOrder",
  allowPastDelivery = false,
): Promise<void> => {
  try {
    const parsed = await parseOrderBody(
      req.body as Record<string, unknown>,
      rejectWith(res, scope),
      allowPastDelivery,
    );
    if (!parsed) {
      return;
    }
    req.body = parsed;
    next();
  } catch (error) {
    logger.error(i18next.t(`orders.${scope}.validators.logs.validationError`, { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t(`orders.${scope}.validators.validationError`),
    );
  }
};

/** `POST /orders` — the creation contract. A brand-new order has no existing date, so its delivery
 *  must always be in the future. */
export const validateCreateOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => runOrderBodyValidator(req, res, next, "createOrder");

/**
 * `PUT /orders/:id` — the SAME contract as create (an edit describes the whole order, so nothing may
 * be validated more loosely), with ONE deliberate difference: the delivery date is unconstrained.
 * See the rule in {@link parseOrderBody} — an edit is a correction, not a scheduling decision.
 */
export const validateUpdateOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => runOrderBodyValidator(req, res, next, "updateOrder", true);

/** Log the availability validator warning for `key` and send its standard 400. */
const rejectAvailability = (res: Response, key: string, logParams: Record<string, unknown>): void => {
  logger.warn(i18next.t(`orders.availability.validators.logs.${key}`, logParams));
  sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(`orders.availability.validators.${key}`));
};

/** Sensible cap for a per-window availability probe — far above any real catalog page. */
const MAX_AVAILABILITY_PRODUCTS = 200;

/** An OPTIONAL positive-integer id on the probe body: absent stays absent, present must be a real
 *  id. `null` counts as absent (a form clearing a select sends it). */
const sanitizeOptionalId = (
  value: unknown,
): { ok: true; value: number | undefined } | { ok: false } => {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? { ok: true, value }
    : { ok: false };
};

/**
 * `POST /orders/availability` — validates the live probe: a delivery datetime, an OPTIONAL pickup
 * (after delivery when present — omitting it means "no rental window yet"), 1..N product ids, and
 * the OPTIONAL driver half (`assignedUserId`, plus `excludeOrderId` when an EDIT is re-checking
 * itself). The driver is not looked up here: the probe is read-only and advisory, and an unknown id
 * simply finds no orders — the save's validator is where an invalid assignee is refused.
 */
export const validateOrderAvailability = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const body = req.body as Record<string, unknown>;

    const deliveryAt = parseDate(body["deliveryAt"]);
    if (!deliveryAt) {
      rejectAvailability(res, "invalidDeliveryAt", { deliveryAt: body["deliveryAt"] });
      return;
    }

    let pickupAt: Date | undefined;
    const rawPickupAt = body["pickupAt"];
    if (rawPickupAt !== undefined && rawPickupAt !== null && rawPickupAt !== "") {
      const parsed = parseDate(rawPickupAt);
      if (!parsed) {
        rejectAvailability(res, "invalidPickupAt", { pickupAt: rawPickupAt });
        return;
      }
      if (parsed.getTime() <= deliveryAt.getTime()) {
        rejectAvailability(res, "pickupBeforeDelivery", { deliveryAt, pickupAt: parsed });
        return;
      }
      pickupAt = parsed;
    }

    const rawIds = body["productIds"];
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      rejectAvailability(res, "invalidProductIds", { productIds: rawIds });
      return;
    }
    if (rawIds.length > MAX_AVAILABILITY_PRODUCTS) {
      rejectAvailability(res, "tooManyProductIds", { count: rawIds.length });
      return;
    }
    const productIds: number[] = [];
    for (const id of rawIds) {
      if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
        rejectAvailability(res, "invalidProductIds", { productIds: rawIds });
        return;
      }
      productIds.push(id);
    }

    const assignedUserId = sanitizeOptionalId(body["assignedUserId"]);
    if (!assignedUserId.ok) {
      rejectAvailability(res, "invalidAssignedUserId", {
        assignedUserId: body["assignedUserId"],
      });
      return;
    }
    const excludeOrderId = sanitizeOptionalId(body["excludeOrderId"]);
    if (!excludeOrderId.ok) {
      rejectAvailability(res, "invalidExcludeOrderId", {
        excludeOrderId: body["excludeOrderId"],
      });
      return;
    }

    req.body = {
      deliveryAt,
      pickupAt,
      productIds,
      assignedUserId: assignedUserId.value,
      excludeOrderId: excludeOrderId.value,
    };
    next();
  } catch (error) {
    logger.error(i18next.t("orders.availability.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.availability.validators.validationError"),
    );
  }
};
