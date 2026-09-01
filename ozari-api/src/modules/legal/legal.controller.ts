import type { Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { loadSettings } from "@modules/preferences/preferences.service.js";
import type { TermsResponseModel } from "./legal.models.js";

/**
 * `GET /legal/terms` — **PUBLIC.** The business's terms and conditions, as text.
 *
 * This is the "narrower letterhead endpoint" EPIC-2-DOCUMENTS §10 left a door open for, and the
 * register screen is what needed it: somebody being asked to ACCEPT terms has to be able to read
 * them, and they have no session yet by definition. Widening the Admin-only `/preferences` would
 * have handed an anonymous visitor every catalog, every operational rule and the bank accounts to
 * publish one paragraph — so the narrow door is the whole point.
 *
 * It reads through the same settings registry as the admin screen (never its own copy of the key),
 * so the text a client accepts is exactly the text the admin wrote, clamped the same way.
 *
 * **An empty answer is a legitimate one**, not a 404: a business that has not written terms is a
 * perfectly valid configuration, and the client's job is then to offer nothing to read rather than
 * to show an error about a document that was never supposed to exist.
 */
export const getTerms = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const settings = await loadSettings(prismaClient);
    const terms = settings.find((setting) => setting.key === "documents.terms");

    const response: TermsResponseModel = {
      terms: terms?.type === "text" ? terms.value : "",
    };
    logger.info(i18next.t("legal.getTerms.logs.termsFetched"));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("legal.getTerms.termsFetched"), response);
  } catch (error) {
    logger.error(i18next.t("legal.getTerms.logs.errorFetching", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("legal.getTerms.errorFetching"),
    );
  }
};
