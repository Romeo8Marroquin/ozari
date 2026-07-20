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
import {
  type CreateOrderLineRequestModel,
  type CreateOrderRequestModel,
} from "./orders.models.js";

/** Log the create-order validator warning for `key` and send its standard 400. */
const rejectCreate = (
  res: Response,
  key: string,
  logParams: Record<string, unknown>,
): void => {
  logger.warn(i18next.t(`orders.createOrder.validators.logs.${key}`, logParams));
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`orders.createOrder.validators.${key}`),
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
 * `POST /orders` — the whole creation CONTRACT, enforced before the controller's transaction:
 * identity (an ACTIVE client registry — the walk-in flow; the platform-user variant is a
 * documented door that widens THIS check, never a new endpoint), an active event type, coherent
 * logistics times (pickup required with any RENTAL line and after the delivery; forbidden on a
 * purchase-only order — Q-A), the snapshot texts, optional money fields, and the lines (existing
 * ACTIVE products, no duplicates, bounded quantities, one shared currency, and rental units the
 * day-based billing engine actually supports). Availability and spacing are deliberately NOT
 * checked here — they're racy reads, so the controller re-derives them INSIDE the transaction
 * under the product locks (this validator only guarantees the request is well-formed).
 */
export const validateCreateOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
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
      rejectCreate(res, "invalidClientRegistryId", { clientRegistryId });
      return;
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
      rejectCreate(res, "invalidEventTypeId", { eventTypeId });
      return;
    }

    const deliveryAt = parseDate(body["deliveryAt"]);
    if (!deliveryAt) {
      rejectCreate(res, "invalidDeliveryAt", { deliveryAt: body["deliveryAt"] });
      return;
    }

    // Lines: bounded, deduplicated, integer quantities within the global cap.
    const rawLines = body["lines"];
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      rejectCreate(res, "invalidLines", { lines: rawLines });
      return;
    }
    if (rawLines.length > appConfig.maxOrderLines) {
      rejectCreate(res, "tooManyLines", { count: rawLines.length, max: appConfig.maxOrderLines });
      return;
    }
    const seenProducts = new Set<number>();
    const lines: CreateOrderLineRequestModel[] = [];
    for (const rawLine of rawLines as Array<Record<string, unknown>>) {
      const productId = rawLine?.["productId"];
      const quantity = rawLine?.["quantity"];
      if (typeof productId !== "number" || !Number.isInteger(productId) || productId < 1) {
        rejectCreate(res, "invalidLineProduct", { productId });
        return;
      }
      if (seenProducts.has(productId)) {
        rejectCreate(res, "duplicateLineProduct", { productId });
        return;
      }
      seenProducts.add(productId);
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > appConfig.maxGlobalQuantity
      ) {
        rejectCreate(res, "invalidLineQuantity", { productId, quantity });
        return;
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
        rejectCreate(res, "unknownLineProduct", { productId: line.productId });
        return;
      }
      const isRental = product.productBusinessTypeId === BusinessTypeEnum.RENT;
      // Defensive: the catalog's conditional price rule guarantees these; a violating row must
      // fail loudly here rather than price a line at 0.
      if ((isRental ? product.rentPrice : product.sellPrice) === null) {
        rejectCreate(res, "unknownLineProduct", { productId: line.productId });
        return;
      }
      // The MVP billing engine is day-based: Día multiplies by billed days, Evento is flat.
      // Hora/Semana/Mes need real math of their own — reject loudly, never bill wrong (§2:
      // hourly is a live door, not silent behavior).
      if (
        isRental &&
        product.rentTimeUnitId !== RentTimeUnitEnum.Dia &&
        product.rentTimeUnitId !== RentTimeUnitEnum.Evento
      ) {
        rejectCreate(res, "unsupportedRentTimeUnit", {
          productId: line.productId,
          rentTimeUnitId: product.rentTimeUnitId,
        });
        return;
      }
    }
    const currencyIds = new Set(products.map((product) => product.currencyId));
    if (currencyIds.size > 1) {
      rejectCreate(res, "mixedCurrencies", { currencyIds: [...currencyIds] });
      return;
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
        rejectCreate(res, "pickupRequiredForRental", { pickupAt: rawPickupAt });
        return;
      }
      if (parsed.getTime() <= deliveryAt.getTime()) {
        rejectCreate(res, "pickupBeforeDelivery", { deliveryAt, pickupAt: parsed });
        return;
      }
      pickupAt = parsed;
    } else if (rawPickupAt !== undefined && rawPickupAt !== null) {
      rejectCreate(res, "pickupForbiddenForPurchase", { pickupAt: rawPickupAt });
      return;
    }

    // The delivery snapshots — what the logistics actually use, captured as text (the snapshot
    // doctrine: prefilled from the registry or typed as a one-off venue, never a live FK).
    const deliveryName = sanitizeText(body["deliveryName"], 2, 255);
    if (deliveryName === null) {
      rejectCreate(res, "invalidDeliveryName", { deliveryName: body["deliveryName"] });
      return;
    }
    const deliveryContact = sanitizeText(body["deliveryContact"], 2, 255);
    if (deliveryContact === null) {
      rejectCreate(res, "invalidDeliveryContact", { deliveryContact: body["deliveryContact"] });
      return;
    }
    const deliveryAddress = sanitizeText(body["deliveryAddress"], 5, 500);
    if (deliveryAddress === null) {
      rejectCreate(res, "invalidDeliveryAddress", { deliveryAddress: body["deliveryAddress"] });
      return;
    }

    const description = sanitizeOptionalText(body["description"], 500);
    if (!description.ok) {
      rejectCreate(res, "invalidDescription", { description: body["description"] });
      return;
    }
    const comment = sanitizeOptionalText(body["comment"], 500);
    if (!comment.ok) {
      rejectCreate(res, "invalidComment", { comment: body["comment"] });
      return;
    }
    const deliveryAmount = sanitizeOptionalMoney(body["deliveryAmount"]);
    if (!deliveryAmount.ok) {
      rejectCreate(res, "invalidDeliveryAmount", { deliveryAmount: body["deliveryAmount"] });
      return;
    }
    const depositAmount = sanitizeOptionalMoney(body["depositAmount"]);
    if (!depositAmount.ok) {
      rejectCreate(res, "invalidDepositAmount", { depositAmount: body["depositAmount"] });
      return;
    }

    const validatedBody: CreateOrderRequestModel = {
      clientRegistryId: clientRegistryId as number,
      eventTypeId: eventTypeId as number,
      deliveryAt,
      pickupAt,
      deliveryName,
      deliveryContact,
      deliveryAddress,
      description: description.value,
      comment: comment.value,
      deliveryAmount: deliveryAmount.value,
      depositAmount: depositAmount.value,
      lines,
    };
    req.body = validatedBody;
    next();
  } catch (error) {
    logger.error(i18next.t("orders.createOrder.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.createOrder.validators.validationError"),
    );
  }
};
