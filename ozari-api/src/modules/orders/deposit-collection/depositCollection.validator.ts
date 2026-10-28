import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { SETTLEMENT_TEXT_MAX_LENGTH } from "../settlement/settlement.validator.js";
import type { DepositCollectionRequestModel } from "../orders.models.js";

/** Why a collection body is unusable — each is its own `400` message. */
export type DepositCollectionParseErrorModel =
  | "invalidReceived"
  | "invalidReason"
  | "reasonRequired";

/**
 * The collection body's SHAPE — shared by `PUT /orders/:id/deposit-collection` and the delivery
 * advance's optional `depositCollection`, so the two doors accept exactly the same answers.
 *
 * `received` is a real boolean. Not receiving a deposit REQUIRES saying why (trimmed, 1–500 chars —
 * a relative, a trusted client…): handing goods over without the deposit is precisely the decision
 * a reason exists to explain. When it WAS received the reason is meaningless and is dropped.
 */
export function parseDepositCollection(
  value: unknown,
): { body: DepositCollectionRequestModel } | { error: DepositCollectionParseErrorModel } {
  const source = (value ?? {}) as Record<string, unknown>;
  const received = source["received"];
  if (typeof received !== "boolean") {
    return { error: "invalidReceived" };
  }
  if (received) {
    return { body: { received, reason: undefined } };
  }
  const reason = source["reason"];
  if (reason === undefined || reason === null) {
    return { error: "reasonRequired" };
  }
  if (typeof reason !== "string") {
    return { error: "invalidReason" };
  }
  const trimmed = reason.trim();
  if (trimmed === "") {
    return { error: "reasonRequired" };
  }
  if (trimmed.length > SETTLEMENT_TEXT_MAX_LENGTH) {
    return { error: "invalidReason" };
  }
  return { body: { received, reason: trimmed } };
}

/** A `400` about the REQUEST, from the deposit-collection namespace. */
const rejectCollection = (res: Response, key: string): void => {
  logger.warn(i18next.t(`orders.depositCollection.validators.logs.${key}`));
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`orders.depositCollection.validators.${key}`),
  );
};

/** A positive integer path id — a malformed URL is a clean `400`, never a `NaN` reaching a query. */
const hasValidId = (req: Request): boolean => {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0;
};

/**
 * `PUT /orders/:id/deposit-collection` — the SHAPE contract only. Whether the order has a deposit to
 * collect, is cancelled or already carries a damage report is decided inside the transaction under
 * the row lock (the settlement door's stance).
 */
export const validateRecordDepositCollection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!hasValidId(req)) {
    rejectCollection(res, "invalidId");
    return;
  }
  const parsed = parseDepositCollection(req.body);
  if ("error" in parsed) {
    rejectCollection(res, parsed.error);
    return;
  }
  req.body = parsed.body;
  next();
};

/** `DELETE /orders/:id/deposit-collection` — nothing to validate but the id. */
export const validateClearDepositCollection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!hasValidId(req)) {
    rejectCollection(res, "invalidId");
    return;
  }
  next();
};
