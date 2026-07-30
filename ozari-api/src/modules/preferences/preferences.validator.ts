/* eslint-disable complexity -- each validator here is ONE linear pass over the body, every check
   rejecting with its own key, in an order that matters. Same shape (and same rationale) as
   `orders.validator.ts`: splitting them into helpers would scatter the contract a reader needs to
   see in one place. */
import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { catalogByKey, type CatalogDefinition } from "./preferences.catalogs.js";
import { PREFERENCE_SETTINGS, settingDefinitionFor } from "./preferences.service.js";
import type {
  CatalogRowRequestModel,
  UpdatePreferenceSettingsRequestModel,
} from "./preferences.models.js";

const NAME_MIN = 2;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

/** Log the preferences validator warning for `key` and send its standard 400. */
const reject = (res: Response, key: string, logParams: Record<string, unknown>): void => {
  logger.warn(i18next.t(`preferences.validators.logs.${key}`, logParams));
  sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(`preferences.validators.${key}`));
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
 * `PUT /preferences/settings` — the whole editable set, each value an integer inside the bounds the
 * registry declares (the same bounds the client was handed by `GET /preferences`, so a rejection here
 * means a tampered or stale client, not a user typo).
 *
 * Two rules beyond per-field bounds:
 *  - an unknown or non-editable key is REJECTED, never ignored — silently dropping it would let a
 *    client believe it saved something the system will never read;
 *  - the evidence pair must stay coherent (`max >= min`), because a status inheriting an inverted
 *    global range would be unsatisfiable — no photo count could ever pass.
 */
export const validateUpdatePreferenceSettings = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const body = req.body as Record<string, unknown>;
    const rawSettings = body["settings"];
    if (!Array.isArray(rawSettings) || rawSettings.length === 0) {
      reject(res, "invalidSettings", { settings: rawSettings });
      return;
    }
    if (rawSettings.length > PREFERENCE_SETTINGS.length) {
      reject(res, "invalidSettings", { count: rawSettings.length });
      return;
    }

    const seen = new Set<string>();
    const settings: { key: string; value: number }[] = [];
    for (const raw of rawSettings as Array<Record<string, unknown>>) {
      const key = raw?.["key"];
      const value = raw?.["value"];
      // ONE lookup answers both "may this be written?" and "within what bounds?".
      const definition = typeof key === "string" ? settingDefinitionFor(key) : undefined;
      if (!definition) {
        reject(res, "unknownSetting", { key });
        return;
      }
      if (seen.has(definition.key)) {
        reject(res, "duplicateSetting", { key });
        return;
      }
      seen.add(definition.key);
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < definition.min ||
        value > definition.max
      ) {
        reject(res, "invalidSettingValue", { key, value, min: definition.min, max: definition.max });
        return;
      }
      settings.push({ key: definition.key, value });
    }

    // Cross-field: the evidence range must stay satisfiable. Only checked when BOTH arrive, which
    // the client always does — it sends the full set.
    const min = settings.find((setting) => setting.key === "orders.evidenceMinPhotos")?.value;
    const max = settings.find((setting) => setting.key === "orders.evidenceMaxPhotos")?.value;
    if (min !== undefined && max !== undefined && max < min) {
      reject(res, "invertedEvidenceRange", { min, max });
      return;
    }

    const validated: UpdatePreferenceSettingsRequestModel = { settings };
    req.body = validated;
    next();
  } catch (error) {
    logger.error(i18next.t("preferences.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("preferences.validators.validationError"),
    );
  }
};

/** Parses ONE extra field per its declared kind, appending to `data`. Returns the rejection key on
 *  failure so the caller answers and stops. */
async function parseExtraField(
  field: CatalogDefinition["extraFields"][number],
  raw: unknown,
  data: CatalogRowRequestModel,
): Promise<string | null> {
  if (field.kind === "int") {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < field.min || raw > field.max) {
      return "invalidExtraField";
    }
    data.minLeadHours = raw;
    return null;
  }
  if (field.kind === "money") {
    // Absent/null is meaningful for a fee: "not configured", which is NOT the same as free (0).
    if (raw === undefined || raw === null) {
      data.deliveryFee = null;
      return null;
    }
    if (typeof raw !== "number" || Number.isNaN(raw) || raw < 0 || raw > appConfig.maxGlobalAmount) {
      return "invalidExtraField";
    }
    data.deliveryFee = Math.trunc(raw * 100) / 100;
    return null;
  }
  // `ref` — the id must exist AND be published, else a zone could point at a retired municipality.
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return "invalidExtraField";
  }
  const prismaClient = await getPrismaClient();
  const municipality = await prismaClient.municipality.findFirst({
    where: { id: raw, isActive: true },
    select: { id: true },
  });
  if (!municipality) {
    return "invalidExtraField";
  }
  data.municipalityId = raw;
  return null;
}

/**
 * `POST`/`PUT /preferences/catalogs/:catalog[/:id]` — the shared row contract, narrowed by the
 * REGISTRY: a catalog only ever receives the extra fields it declares, so an event type can't be sent
 * a `deliveryFee` and a zone can't be saved without its municipality. That is what keeps one endpoint
 * honest across six tables.
 *
 * An unknown `:catalog` is a **404** rather than a 400: the segment names a resource, and an
 * unlisted table must read as "no such thing here" — including for the lookups deliberately kept
 * unmanageable (roles, currencies, business types…), which must never look merely malformed.
 */
export const validateCatalogRow = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const catalog = catalogByKey(String(req.params["catalog"]));
    if (!catalog) {
      logger.warn(
        i18next.t("preferences.validators.logs.unknownCatalog", {
          catalog: req.params["catalog"],
        }),
      );
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("preferences.validators.unknownCatalog"));
      return;
    }

    const body = req.body as Record<string, unknown>;
    const name = sanitizeText(body["name"], NAME_MIN, NAME_MAX);
    if (name === null) {
      reject(res, "invalidName", { name: body["name"] });
      return;
    }

    const rawDescription = body["description"];
    let description: string | undefined;
    if (rawDescription !== undefined && rawDescription !== null && rawDescription !== "") {
      const sanitized = sanitizeText(rawDescription, 1, DESCRIPTION_MAX);
      if (sanitized === null) {
        reject(res, "invalidDescription", { description: rawDescription });
        return;
      }
      description = sanitized;
    }

    const rawIsActive = body["isActive"];
    if (typeof rawIsActive !== "boolean") {
      reject(res, "invalidIsActive", { isActive: rawIsActive });
      return;
    }

    const data: CatalogRowRequestModel = { name, description, isActive: rawIsActive };
    // Sequential ON PURPOSE (a `ref` field hits the database): the fields are two at most, they write
    // into one shared object, and the FIRST failure is the one worth reporting — running them
    // concurrently would race the writes and pick an arbitrary error to show.
    for (const field of catalog.extraFields) {
      // eslint-disable-next-line no-await-in-loop -- see above
      const failure = await parseExtraField(field, body[field.name], data);
      if (failure) {
        reject(res, failure, { field: field.name, value: body[field.name] });
        return;
      }
    }

    req.body = data;
    next();
  } catch (error) {
    logger.error(i18next.t("preferences.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("preferences.validators.validationError"),
    );
  }
};
