import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { appConfig } from "@/config/app.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import type {
  AdvanceOrderRequestModel,
  CreateOrderEvidenceUploadsRequestModel,
} from "./advance.models.js";

/** Longest cancel reason accepted — a sentence or two, not an essay. */
export const CANCEL_REASON_MAX_LENGTH = 500;
/** Hard cap on evidence keys per request (the per-status count is enforced by the engine, under the
 *  row lock — this is only an input bound so a malicious body can't be unbounded). */
export const EVIDENCE_KEYS_MAX = 20;
/** An R2 object key as our own presign mints it: the evidence prefix + a uuid + an extension. A
 *  client-invented key can therefore never point outside the orders' evidence namespace (a
 *  traversal like `…/../products/x.jpg` fails the filename pattern after the prefix is stripped). */
const EVIDENCE_PREFIX = `${appConfig.storage.keyPrefixes.orderEvidence}/`;
const EVIDENCE_FILE_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

const isEvidenceKey = (key: unknown): key is string =>
  typeof key === "string" &&
  key.startsWith(EVIDENCE_PREFIX) &&
  EVIDENCE_FILE_PATTERN.test(key.slice(EVIDENCE_PREFIX.length));

/** Log the advance validator warning for `key` and send its standard 400. */
const reject = (
  res: Response,
  key: string,
  logParams: Record<string, unknown> = {},
): void => {
  logger.warn(i18next.t(`orders.advance.validators.logs.${key}`, logParams));
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`orders.advance.validators.${key}`),
  );
};

/**
 * `POST /orders/:id/advance` — the SHAPE contract only. Everything semantic (is this a legal move,
 * may this actor make it, does the target demand photos, how many) is decided by the lifecycle
 * engine inside the transaction, under the row lock: a validator that pre-checked it would either
 * duplicate the machine or race it.
 */
/** The submitted evidence keys, or `null` when the list itself is unusable. Absent = no photos; a
 *  repeated key would collide on the unique `r2_key`, so duplicates are dropped rather than failing
 *  a well-meant double-add in the uploader. */
const parseEvidenceKeys = (value: unknown): string[] | null => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > EVIDENCE_KEYS_MAX) {
    return null;
  }
  return value.every(isEvidenceKey) ? [...new Set(value)] : null;
};

/** The trimmed cancel reason: `undefined` when absent, `null` when present but unusable. */
const parseReason = (value: unknown): string | undefined | null => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= CANCEL_REASON_MAX_LENGTH
    ? trimmed
    : null;
};

export const validateAdvanceOrder = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const toStatusId = Number(body["toStatusId"]);
    if (!Number.isInteger(toStatusId) || toStatusId < 1) {
      reject(res, "invalidToStatusId", { toStatusId: body["toStatusId"] });
      return;
    }

    const evidenceKeys = parseEvidenceKeys(body["evidenceKeys"]);
    if (evidenceKeys === null) {
      reject(res, "invalidEvidenceKeys", {});
      return;
    }

    const reason = parseReason(body["reason"]);
    if (reason === null) {
      reject(res, "invalidReason", {});
      return;
    }

    const validated: AdvanceOrderRequestModel = {
      toStatusId,
      evidenceKeys,
      reason,
    };
    req.body = validated;
    next();
  } catch (error) {
    logger.error(i18next.t("orders.advance.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.advance.validators.validationError"),
    );
  }
};

/**
 * `POST /orders/evidence/upload-url` — the same shape contract as the products image presign: a
 * bounded list of `{ contentType, contentLength }`. The storage policy itself (allowed types, max
 * bytes) is enforced by `createUpload`, which binds both INTO the signature.
 */
export const validateOrderEvidenceUploads = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const files = body["files"];
    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      files.length > EVIDENCE_KEYS_MAX
    ) {
      reject(res, "invalidFiles", { count: Array.isArray(files) ? files.length : 0 });
      return;
    }
    const parsed = files.map((file) => file as Record<string, unknown>);
    const valid = parsed.every(
      (file) =>
        typeof file["contentType"] === "string" &&
        file["contentType"] !== "" &&
        Number.isInteger(file["contentLength"]) &&
        (file["contentLength"] as number) > 0,
    );
    if (!valid) {
      reject(res, "invalidFiles", { count: files.length });
      return;
    }

    const validated: CreateOrderEvidenceUploadsRequestModel = {
      files: parsed.map((file) => ({
        contentType: file["contentType"] as string,
        contentLength: file["contentLength"] as number,
      })),
    };
    req.body = validated;
    next();
  } catch (error) {
    logger.error(i18next.t("orders.advance.validators.logs.validationError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.advance.validators.validationError"),
    );
  }
};
