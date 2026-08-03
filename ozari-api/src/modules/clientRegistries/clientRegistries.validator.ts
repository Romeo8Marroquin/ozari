/* eslint-disable sonarjs/cognitive-complexity, complexity -- one linear pass over the create body
   (the products/orders validator shape): each check rejects with its own key, in contract order. */
import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { ContactTypeEnum } from "@models/enums/contactTypeEnum.js";
import { emailRegex, isValidContactPhone } from "@helpers/regex.js";
import { sanitizeCoords } from "@helpers/geo.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  type CreateClientRegistryRequestModel,
  type CreateRegistryAddressRequestModel,
  type CreateRegistryContactRequestModel,
} from "./clientRegistries.models.js";

// Sensible hard bounds for a person's records — far above any real client, low enough that a
// stuck client can't grow a row unboundedly.
const MAX_CONTACTS = 10;
const MAX_ADDRESSES = 10;

/** Log the create-registry validator warning for `key` and send its standard 400. */
const rejectCreate = (
  res: Response,
  key: string,
  logParams: Record<string, unknown>,
): void => {
  logger.warn(
    i18next.t(`clientRegistries.createRegistry.validators.logs.${key}`, logParams),
  );
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`clientRegistries.createRegistry.validators.${key}`),
  );
};

/** A required text field: trimmed, within `[min, max]`; `null` = invalid. */
const sanitizeText = (value: unknown, min: number, max: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
};

/**
 * `POST /client-registries` — the walk-in client record's contract: a name (2–255; deliberately
 * looser than the account `fullName` policy — "Doña María la del canasto" is a perfectly good
 * registry name), optional notes, 1–10 contacts (active contact types, exactly one principal —
 * defaulted to the first when none is flagged), 0–10 addresses (optional ACTIVE zone, 5–500 address
 * text, exactly one favorite — same defaulting; a walk-in may have none and type one per order) and
 * an optional preferred payment method. The sanitized body replaces `req.body`.
 */
export const validateCreateClientRegistry = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    const name = sanitizeText(body["name"], 2, 255);
    if (name === null) {
      rejectCreate(res, "invalidName", { name: body["name"] });
      return;
    }

    let notes: string | undefined;
    if (body["notes"] !== undefined && body["notes"] !== null && body["notes"] !== "") {
      const sanitized = sanitizeText(body["notes"], 1, 500);
      if (sanitized === null) {
        rejectCreate(res, "invalidNotes", { notes: body["notes"] });
        return;
      }
      notes = sanitized;
    }

    // Contacts: 1..MAX, active types, values 2–255, at most one explicit principal.
    const rawContacts = body["contacts"];
    if (!Array.isArray(rawContacts) || rawContacts.length === 0) {
      rejectCreate(res, "invalidContacts", { contacts: rawContacts });
      return;
    }
    if (rawContacts.length > MAX_CONTACTS) {
      rejectCreate(res, "tooManyContacts", { count: rawContacts.length, max: MAX_CONTACTS });
      return;
    }
    const prismaClient = await getPrismaClient();
    const activeContactTypes = await prismaClient.contactType.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const contactTypeIds = new Set(activeContactTypes.map((type) => type.id));
    const contacts: CreateRegistryContactRequestModel[] = [];
    let principalCount = 0;
    for (const rawContact of rawContacts as Array<Record<string, unknown>>) {
      const contactTypeId = rawContact?.["contactTypeId"];
      if (typeof contactTypeId !== "number" || !contactTypeIds.has(contactTypeId)) {
        rejectCreate(res, "invalidContactTypeId", { contactTypeId });
        return;
      }
      const value = sanitizeText(rawContact["value"], 2, 255);
      if (value === null) {
        rejectCreate(res, "invalidContactValue", { value: rawContact["value"] });
        return;
      }
      // Per-channel shape: email must look like an email, WhatsApp/phone like a phone number
      // (mirrors the frontend). OTHER is length-only.
      if (contactTypeId === ContactTypeEnum.CORREO && !emailRegex.test(value)) {
        rejectCreate(res, "invalidContactEmail", { value });
        return;
      }
      if (
        (contactTypeId === ContactTypeEnum.WHATSAPP ||
          contactTypeId === ContactTypeEnum.TELEFONO) &&
        !isValidContactPhone(value)
      ) {
        rejectCreate(res, "invalidContactPhone", { value });
        return;
      }
      const isPrincipal = rawContact["isPrincipal"] === true;
      if (isPrincipal) {
        principalCount += 1;
      }
      contacts.push({ contactTypeId, value, isPrincipal });
    }
    if (principalCount > 1) {
      rejectCreate(res, "multiplePrincipalContacts", { principalCount });
      return;
    }
    if (principalCount === 0 && contacts[0]) {
      contacts[0].isPrincipal = true;
    }

    // Addresses: 0..MAX (a walk-in may have NO saved venue — each order types one), optional active
    // zone, 5–500 text, at most one explicit favorite.
    const rawAddresses = body["addresses"] ?? [];
    if (!Array.isArray(rawAddresses)) {
      rejectCreate(res, "invalidAddresses", { addresses: rawAddresses });
      return;
    }
    if (rawAddresses.length > MAX_ADDRESSES) {
      rejectCreate(res, "tooManyAddresses", { count: rawAddresses.length, max: MAX_ADDRESSES });
      return;
    }
    const activeZones = await prismaClient.zone.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const zoneIds = new Set(activeZones.map((zone) => zone.id));
    const addresses: CreateRegistryAddressRequestModel[] = [];
    let favoriteCount = 0;
    for (const rawAddress of rawAddresses as Array<Record<string, unknown>>) {
      const rawZoneId = rawAddress?.["zoneId"];
      let zoneId: number | undefined;
      if (rawZoneId !== undefined && rawZoneId !== null) {
        if (typeof rawZoneId !== "number" || !zoneIds.has(rawZoneId)) {
          rejectCreate(res, "invalidZoneId", { zoneId: rawZoneId });
          return;
        }
        zoneId = rawZoneId;
      }
      const address = sanitizeText(rawAddress["address"], 5, 500);
      if (address === null) {
        rejectCreate(res, "invalidAddress", { address: rawAddress["address"] });
        return;
      }
      let instructions: string | undefined;
      const rawInstructions = rawAddress["instructions"];
      if (rawInstructions !== undefined && rawInstructions !== null && rawInstructions !== "") {
        const sanitized = sanitizeText(rawInstructions, 1, 500);
        if (sanitized === null) {
          rejectCreate(res, "invalidInstructions", { instructions: rawInstructions });
          return;
        }
        instructions = sanitized;
      }
      let domicilePrice: number | undefined;
      const rawDomicilePrice = rawAddress["domicilePrice"];
      if (rawDomicilePrice !== undefined && rawDomicilePrice !== null) {
        if (
          typeof rawDomicilePrice !== "number" ||
          Number.isNaN(rawDomicilePrice) ||
          rawDomicilePrice < 0 ||
          rawDomicilePrice > appConfig.maxGlobalAmount
        ) {
          rejectCreate(res, "invalidDomicilePrice", { domicilePrice: rawDomicilePrice });
          return;
        }
        domicilePrice = Math.trunc(rawDomicilePrice * 100) / 100;
      }
      // The map pin — optional everywhere. An ABSENT pin is the normal case, but a malformed one is
      // rejected rather than dropped: silently discarding a coordinate the admin just placed would
      // be indistinguishable, to them, from the map not working.
      const coords = sanitizeCoords(rawAddress["coords"]);
      if (!coords.ok) {
        rejectCreate(res, "invalidCoords", { coords: rawAddress["coords"] });
        return;
      }
      const isFavorite = rawAddress["isFavorite"] === true;
      if (isFavorite) {
        favoriteCount += 1;
      }
      addresses.push({
        ...(zoneId !== undefined && { zoneId }),
        address,
        ...(instructions !== undefined && { instructions }),
        ...(coords.value !== undefined && { coords: coords.value }),
        ...(domicilePrice !== undefined && { domicilePrice }),
        isFavorite,
      });
    }
    if (favoriteCount > 1) {
      rejectCreate(res, "multipleFavoriteAddresses", { favoriteCount });
      return;
    }
    if (favoriteCount === 0 && addresses[0]) {
      addresses[0].isFavorite = true;
    }

    // Preferred payment method (optional): when present it must be an ACTIVE seeded method.
    let preferredPaymentMethodId: number | undefined;
    const rawPreferred = body["preferredPaymentMethodId"];
    if (rawPreferred !== undefined && rawPreferred !== null) {
      const activePaymentMethods = await prismaClient.paymentMethod.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      const paymentMethodIds = new Set(activePaymentMethods.map((method) => method.id));
      if (typeof rawPreferred !== "number" || !paymentMethodIds.has(rawPreferred)) {
        rejectCreate(res, "invalidPreferredPaymentMethodId", {
          preferredPaymentMethodId: rawPreferred,
        });
        return;
      }
      preferredPaymentMethodId = rawPreferred;
    }

    const validatedBody: CreateClientRegistryRequestModel = {
      name,
      notes,
      contacts,
      addresses,
      preferredPaymentMethodId,
    };
    req.body = validatedBody;
    next();
  } catch (error) {
    logger.error(
      i18next.t("clientRegistries.createRegistry.validators.logs.validationError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("clientRegistries.createRegistry.validators.validationError"),
    );
  }
};
