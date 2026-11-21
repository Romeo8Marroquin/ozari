import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { DOCUMENT_IMAGE_URL_MAX_LENGTH } from "./documents.models.js";

/**
 * `GET /documents/image?url=` — the query's SHAPE: exactly one `url`, a non-empty string within
 * {@link DOCUMENT_IMAGE_URL_MAX_LENGTH}. Whether it names one of OUR assets is the controller's
 * question (`Storage.keyFromPublicUrl`), because only the storage helper knows the public base.
 */
export const validateDocumentImageQuery = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const url: unknown = req.query["url"];
  if (
    typeof url !== "string" ||
    url.trim().length === 0 ||
    url.length > DOCUMENT_IMAGE_URL_MAX_LENGTH
  ) {
    logger.warn(i18next.t("documents.getImage.validators.logs.url"));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("documents.getImage.validators.url"));
    return;
  }
  next();
};
