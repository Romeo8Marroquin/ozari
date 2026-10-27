import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import type {
  SettleOrderDamageRequestModel,
  SettleOrderRequestModel,
} from "../orders.models.js";

/** Longest retention reason / damage note — a sentence or two, like a cancel reason. */
export const SETTLEMENT_TEXT_MAX_LENGTH = 500;

/** A `400` about the REQUEST, phrased from the settlement namespace both doors share. */
const rejectSettlement = (res: Response, key: string): void => {
  logger.warn(i18next.t(`orders.settlement.validators.logs.${key}`));
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`orders.settlement.validators.${key}`),
  );
};

/** A positive integer path id — a malformed URL is a clean `400`, never a `NaN` reaching a query. */
const hasValidId = (req: Request): boolean => {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0;
};

/** Trimmed optional text: `undefined` when absent/blank, `null` when present but unusable. */
const parseText = (value: unknown): string | undefined | null => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  return trimmed.length <= SETTLEMENT_TEXT_MAX_LENGTH ? trimmed : null;
};

/** The damage list, or `null` when any entry is unusable. A line may appear once; a quantity of 0
 *  is simply "no damage" and is expected to be left out rather than sent. */
const parseDamages = (value: unknown): SettleOrderDamageRequestModel[] | null => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > appConfig.maxOrderLines) {
    return null;
  }
  const seen = new Set<number>();
  const parsed: SettleOrderDamageRequestModel[] = [];
  for (const raw of value) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const lineId = entry["lineId"];
    const quantity = entry["quantity"];
    const note = parseText(entry["note"]);
    if (
      !Number.isInteger(lineId) ||
      (lineId as number) < 1 ||
      seen.has(lineId as number) ||
      !Number.isInteger(quantity) ||
      (quantity as number) < 1 ||
      (quantity as number) > appConfig.maxGlobalQuantity ||
      note === null
    ) {
      return null;
    }
    seen.add(lineId as number);
    parsed.push({ lineId: lineId as number, quantity: quantity as number, note });
  }
  return parsed;
};

/**
 * `PUT /orders/:id/settlement` — the SHAPE contract only. Whether the order can be settled at all,
 * whether each line can carry damage and whether the deposit covers what is retained are decided
 * inside the transaction under the row lock (the payment door's stance): a pre-check would either
 * duplicate the write's guard or race it.
 *
 * `retainedAmount` is required (0 = the deposit goes back whole), money-shaped and truncated to
 * cents; its reason is REQUIRED exactly when something is retained — keeping a client's money
 * without saying why is the dispute the reason exists to prevent — and dropped when nothing is.
 */
export const validateSettleOrder = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const reject = (key: string): void => rejectSettlement(res, key);
  if (!hasValidId(req)) {
    reject("invalidId");
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  const retained = body["retainedAmount"];
  if (
    typeof retained !== "number" ||
    Number.isNaN(retained) ||
    retained < 0 ||
    retained > appConfig.maxGlobalAmount
  ) {
    reject("invalidRetainedAmount");
    return;
  }
  const retainedAmount = Math.trunc(retained * 100) / 100;

  const reason = parseText(body["retainedReason"]);
  if (reason === null) {
    reject("invalidRetainedReason");
    return;
  }
  if (retainedAmount > 0 && reason === undefined) {
    reject("retainedReasonRequired");
    return;
  }

  const damages = parseDamages(body["damages"]);
  if (damages === null) {
    reject("invalidDamages");
    return;
  }

  const validated: SettleOrderRequestModel = {
    retainedAmount,
    retainedReason: retainedAmount > 0 ? reason : undefined,
    damages,
  };
  req.body = validated;
  next();
};

/** `DELETE /orders/:id/settlement` — nothing to validate but the id (the act carries no options). */
export const validateUndoSettlement = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!hasValidId(req)) {
    rejectSettlement(res, "invalidId");
    return;
  }
  next();
};
