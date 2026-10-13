import type { NextFunction, Request, Response } from "express";
import { isRegistrationOpen } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import type { RegistrationStatusResponseModel } from "./auth.models.js";

/**
 * Whether this environment accepts new accounts (`GET /auth/registration`).
 *
 * **Public**: the visitor asking has no session by definition. The app reads it to decide whether
 * to offer the sign-up link and the register form at all — it never GUESSES (CLAUDE.md §2): the
 * server owns the policy and reports it, and `POST /auth/user` enforces the same answer.
 */
export const getRegistrationStatus = (_req: Request, res: Response): void => {
  const response: RegistrationStatusResponseModel = { open: isRegistrationOpen() };
  sendOzariSuccess(
    res,
    HttpEnum.OK,
    i18next.t("user.registration.statusFetched"),
    response,
  );
};

/**
 * Guards `POST /auth/user`. Runs BEFORE validation, so a closed environment answers the same `403`
 * whatever the body holds — it confirms nothing about which emails exist or what a valid password
 * looks like here. The app hides the form when closed; this is what makes that more than cosmetic.
 */
export const requireRegistrationOpen = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (isRegistrationOpen()) {
    next();
    return;
  }
  logger.warn(i18next.t("user.registration.logs.rejectedClosed", { ip: req.ip }));
  sendOzariError(res, HttpEnum.FORBIDDEN, i18next.t("user.registration.closed"));
};
