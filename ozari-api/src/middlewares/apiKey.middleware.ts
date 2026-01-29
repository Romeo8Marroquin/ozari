import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

let cachedApiKey: string | null = null;

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

    if (!cachedApiKey) {
      cachedApiKey = process.env["API_KEY"] ?? null;

      if (!cachedApiKey) {
        logger.error("API_KEY environment variable is not defined");
        sendOzariError(
          res,
          HttpEnum.INTERNAL_SERVER_ERROR,
          i18next.t("middlewares.apiKey.internalServerError"),
        );
        return;
      }
    }

    if (apiKey !== cachedApiKey) {
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
