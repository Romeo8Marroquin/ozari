import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

/**
 * `POST /orders/:id/payment` — the SHAPE contract only.
 *
 * The body is at most `{ paymentMethodId }`. Whether that method EXISTS (and is published) is
 * decided inside the transaction alongside the row lock, for the same reason the advance validator
 * defers its semantics: a pre-check would either duplicate the write's guard or race it.
 *
 * The id itself is validated here rather than in the controller so a malformed URL is a clean `400`
 * about the request instead of a `NaN` reaching a query.
 */
export const validatePayOrder = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const reject = (key: string): void => {
    logger.warn(i18next.t(`orders.payOrder.validators.logs.${key}`));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t(`orders.payOrder.validators.${key}`),
    );
  };

  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    reject("invalidId");
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body["paymentMethodId"];
  if (raw !== undefined && raw !== null) {
    if (!Number.isInteger(raw) || (raw as number) <= 0) {
      reject("invalidMethod");
      return;
    }
    req.body = { paymentMethodId: raw as number };
    next();
    return;
  }
  // Normalised to an empty body: a method is optional, and cash handed over at the door frequently
  // has none recorded.
  req.body = {};
  next();
};
