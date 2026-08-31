import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

/** A `400` about the REQUEST, phrased from the payment namespace both doors share. */
const rejectPayment = (res: Response, key: string): void => {
  logger.warn(i18next.t(`orders.payOrder.validators.logs.${key}`));
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`orders.payOrder.validators.${key}`),
  );
};

/** A positive integer path id — validated here rather than in the controller so a malformed URL is
 *  a clean `400` about the request instead of a `NaN` reaching a query. */
const hasValidId = (req: Request): boolean => {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0;
};

/**
 * `POST /orders/:id/payment` — the SHAPE contract only.
 *
 * The body is at most `{ paymentMethodId }`. Whether that method EXISTS (and is published) is
 * decided inside the transaction alongside the row lock, for the same reason the advance validator
 * defers its semantics: a pre-check would either duplicate the write's guard or race it.
 */
export const validatePayOrder = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const reject = (key: string): void => rejectPayment(res, key);

  if (!hasValidId(req)) {
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

/**
 * `DELETE /orders/:id/payment` — deleting an order's payment record.
 *
 * There is nothing to validate but the id: the act carries no options at all, which is deliberate.
 * It removes our own record and nothing else — a refund is money moving back to the client and would
 * need its own amount, date and method. Whether the order actually HAS a payment to delete is
 * decided under the row lock, like every other semantic question here.
 */
export const validateUndoOrderPayment = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!hasValidId(req)) {
    rejectPayment(res, "invalidId");
    return;
  }
  next();
};
