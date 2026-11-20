import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import type { CustomRequest } from "@models/common/customRequestModel.js";
import type {
  AccountPreferencesEnvelopeModel,
  AccountPreferencesModel,
} from "./account.models.js";
import { loadAccountPreferences, saveAccountPreferences } from "./account.service.js";

/**
 * `GET /account/preferences` — the signed-in person's own preferences. Always the CALLER's: there
 * is no `:userId`, so nobody can read (or, below, write) somebody else's — the identity is the token.
 */
export const getAccountPreferences = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    /* v8 ignore next -- `verifyJwt` guarantees a user; the fallback is defensive */
    const userId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    const response: AccountPreferencesEnvelopeModel = {
      preferences: await loadAccountPreferences(prismaClient, userId),
    };
    logger.info(i18next.t("account.getPreferences.logs.fetched", { userId }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("account.getPreferences.fetched"), response);
  } catch (error) {
    logger.error(i18next.t("account.getPreferences.logs.errorFetching", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("account.getPreferences.errorFetching"),
    );
  }
};

/** `PUT /account/preferences` — replaces the caller's preferences; answers with what was stored. */
export const updateAccountPreferences = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    /* v8 ignore next -- `verifyJwt` guarantees a user; the fallback is defensive */
    const userId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    const response: AccountPreferencesEnvelopeModel = {
      preferences: await saveAccountPreferences(
        prismaClient,
        userId,
        req.body as AccountPreferencesModel,
      ),
    };
    logger.info(i18next.t("account.updatePreferences.logs.updated", { userId }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("account.updatePreferences.updated"), response);
  } catch (error) {
    logger.error(i18next.t("account.updatePreferences.logs.errorUpdating", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("account.updatePreferences.errorUpdating"),
    );
  }
};
