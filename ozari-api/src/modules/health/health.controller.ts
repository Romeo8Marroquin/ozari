import type { Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";

export const healthCheck = async (_: Request, res: Response): Promise<void> => {
  logger.info(i18next.t("health.check.logs.serviceHealthy"));
  sendOzariSuccess(res, HttpEnum.OK, i18next.t("health.check.serviceHealthy"));
};
