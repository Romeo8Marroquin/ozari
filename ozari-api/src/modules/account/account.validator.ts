import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import type { AccountPreferencesModel } from "./account.models.js";

/** Log the account validator warning for `key` and send its standard 400. */
const reject = (res: Response, key: string, logParams: Record<string, unknown>): void => {
  logger.warn(i18next.t(`account.validators.logs.${key}`, logParams));
  sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(`account.validators.${key}`));
};

/**
 * `PUT /account/preferences` — the FULL set, declaratively: every key is REQUIRED (`null` included),
 * so a client that forgets one is refused rather than silently resetting it. Values are never
 * coerced (`"3"` is not 3): a body of the wrong shape is a stale or tampered client.
 */
export const validateUpdateAccountPreferences = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const body = req.body as Record<string, unknown> | undefined;
  if (typeof body !== "object" || body === null || !("orderBilledDays" in body)) {
    reject(res, "missingOrderBilledDays", {});
    return;
  }
  const days = body["orderBilledDays"];
  if (
    days !== null &&
    (typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > appConfig.maxBilledDays)
  ) {
    reject(res, "invalidOrderBilledDays", { orderBilledDays: days });
    return;
  }
  const parsed: AccountPreferencesModel = { orderBilledDays: days };
  req.body = parsed;
  next();
};
