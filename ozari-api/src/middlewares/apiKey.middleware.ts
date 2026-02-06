import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

/**
 * Validate API key from request headers
 * Note: No caching - allows API key rotation without server restart
 * Environment variable reads are fast enough for production use
 */
export const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      logger.warn(i18next.t("middlewares.apiKey.logs.missingApiKey"));
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("middlewares.apiKey.defaultMessage"),
      );
      return;
    }

    // Read API key from environment on each request (no caching)
    // This allows for API key rotation without server restart
    const expectedApiKey = process.env["API_KEY"];

    if (!expectedApiKey) {
      logger.error("API_KEY environment variable is not defined");
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("middlewares.apiKey.internalServerError"),
      );
      return;
    }

    // Use constant-time comparison to prevent timing attacks
    if (!secureCompare(apiKey, expectedApiKey)) {
      logger.warn(i18next.t("middlewares.apiKey.logs.invalidApiKey"));
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("middlewares.apiKey.defaultMessage"),
      );
      return;
    }

    next();
  } catch (error) {
    logger.error(
      i18next.t("middlewares.apiKey.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("middlewares.apiKey.internalServerError"),
    );
  }
};

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  // If lengths differ, still compare to prevent timing leak
  const aLength = Buffer.byteLength(a);
  const bLength = Buffer.byteLength(b);

  // Create buffers for comparison
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  // Always compare the same number of bytes to prevent timing attacks
  const maxLength = Math.max(aLength, bLength);
  let result = aLength === bLength ? 0 : 1;

  for (let i = 0; i < maxLength; i++) {
    // Use bitwise OR to accumulate differences without short-circuiting
    result |= (aBuffer[i] ?? 0) ^ (bBuffer[i] ?? 0);
  }

  return result === 0;
}
