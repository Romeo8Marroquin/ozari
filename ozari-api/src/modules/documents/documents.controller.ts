import type { Request, Response } from "express";
import { appConfig } from "@/config/app.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import {
  getStorage,
  StorageTimeoutError,
  StorageValidationError,
} from "@helpers/storage.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { DOCUMENT_IMAGE_CACHE_CONTROL } from "./documents.models.js";

/** Never echo an unbounded client string into a log line. */
const LOGGED_URL_MAX = 200;

/**
 * `GET /documents/image?url=` — one of the app's own photos, as raw bytes, for a printed document
 * (EPIC-2-DOCUMENTS §2d #39, 2026-11-20).
 *
 * The browser builds every PDF (comprobante, cotización, damage report, and whatever document comes
 * next) and must EMBED each row's photo, so it has to read the image's bytes. Read from the public
 * assets host, that is a cross-origin fetch that only works when the edge's CORS headers AND its
 * cache line up — and a cached copy first requested by a plain `<img>` tag carries no CORS header,
 * so the photo was silently dropped. Here the API reads the object over the S3 API instead: same
 * origin as every other call, no CDN in between, nothing to line up.
 *
 * - **Only the app's own assets.** The URL must resolve to a key inside one of the bucket's own
 *   prefixes (`Storage.keyFromPublicUrl`): no other host, no other folder, no traversal — this can
 *   never be turned into a fetch-anything proxy.
 * - **Only printable images**: a stored type the upload policy allows, within its size cap (checked
 *   before the body is read).
 * - **Bytes, not the JSON envelope** — like the ICS feed, the one other non-JSON response. Errors
 *   keep the standard envelope.
 */
export const getDocumentImage = async (req: Request, res: Response): Promise<void> => {
  // The validator has guaranteed a single non-empty string.
  const url = String(req.query["url"]);
  try {
    const storage = getStorage();
    const key = storage.keyFromPublicUrl(url);
    if (key === null) {
      logger.warn(
        i18next.t("documents.getImage.logs.foreign", { url: url.slice(0, LOGGED_URL_MAX) }),
      );
      sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("documents.getImage.foreign"));
      return;
    }

    const object = await storage.getObject(key, appConfig.storage.maxUploadBytes);
    if (object === null) {
      logger.warn(i18next.t("documents.getImage.logs.notFound", { key }));
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("documents.getImage.notFound"));
      return;
    }

    const contentType = object.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!Object.hasOwn(appConfig.storage.allowedImageTypes, contentType)) {
      logger.warn(i18next.t("documents.getImage.logs.notImage", { key, contentType }));
      sendOzariError(
        res,
        HttpEnum.UNPROCESSABLE_ENTITY,
        i18next.t("documents.getImage.notImage"),
      );
      return;
    }

    res.setHeader("content-type", contentType);
    res.setHeader("content-length", String(object.body.byteLength));
    res.setHeader("cache-control", DOCUMENT_IMAGE_CACHE_CONTROL);
    res.status(HttpEnum.OK).end(Buffer.from(object.body));
  } catch (error) {
    if (error instanceof StorageTimeoutError) {
      // Retryable by nature: the store was slow, not the request wrong (the client retries once).
      logger.warn(
        i18next.t("documents.getImage.logs.timeout", { url: url.slice(0, LOGGED_URL_MAX) }),
      );
      sendOzariError(res, HttpEnum.GATEWAY_TIMEOUT, i18next.t("documents.getImage.timeout"));
      return;
    }
    if (error instanceof StorageValidationError) {
      logger.warn(
        i18next.t("documents.getImage.logs.tooLarge", { url: url.slice(0, LOGGED_URL_MAX) }),
      );
      sendOzariError(
        res,
        HttpEnum.UNPROCESSABLE_ENTITY,
        i18next.t("documents.getImage.notImage"),
      );
      return;
    }
    logger.error(i18next.t("documents.getImage.logs.error", { error }), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("documents.getImage.unavailable"),
    );
  }
};
