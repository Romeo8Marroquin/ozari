import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import {
  emailRegex,
  fullNameRegex,
  genericUuidRegex,
  passwordRegex,
} from "@helpers/regex.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  type CreateUserRequestModel,
  type SignInUserRequestModel,
} from "./auth.models.js";

export function validateCreateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.body || typeof req.body !== "object") {
    logger.warn(i18next.t("common.logs.invalidBody"));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("common.invalidBody"));
    return;
  }
  const { confirmPassword, email, fullName, password, termsAccepted } =
    req.body as CreateUserRequestModel;

  if (
    typeof fullName !== "string" ||
    fullName.trim() === "" ||
    !fullNameRegex.test(fullName)
  ) {
    logger.warn(
      i18next.t("user.createUser.validators.logs.invalidFullName", {
        fullName,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.invalidFullName"),
    );
    return;
  }
  const sanitizedEmail = email?.trim().toLowerCase();
  if (typeof email !== "string" || !emailRegex.test(sanitizedEmail)) {
    logger.warn(
      i18next.t("user.createUser.validators.logs.invalidEmail", { email }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.invalidEmail"),
    );
    return;
  }

  if (typeof password !== "string" || !passwordRegex.test(password)) {
    logger.warn(i18next.t("user.createUser.validators.logs.invalidPassword"));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.invalidPassword"),
    );
    return;
  }

  if (typeof confirmPassword !== "string") {
    logger.warn(
      i18next.t("user.createUser.validators.logs.invalidConfirmPassword"),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.invalidConfirmPassword"),
    );
    return;
  }

  if (password !== confirmPassword) {
    logger.warn(
      i18next.t("user.createUser.validators.logs.passwordsDoNotMatch"),
    );

    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.passwordsDoNotMatch"),
    );
    return;
  }

  if (typeof termsAccepted !== "boolean" || !termsAccepted) {
    logger.warn(
      i18next.t("user.createUser.validators.logs.termsNotAccepted", {
        termsAccepted,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.createUser.validators.termsNotAccepted"),
    );
    return;
  }

  const validatedBody: CreateUserRequestModel = {
    confirmPassword,
    email: sanitizedEmail,
    fullName: fullName.trim(),
    password,
    termsAccepted,
  };
  req.body = validatedBody;

  next();
}

export function validateSignIn(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.body || typeof req.body !== "object") {
    logger.warn(i18next.t("common.logs.invalidBody"));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("common.invalidBody"));
    return;
  }
  const { email, password } = req.body as SignInUserRequestModel;
  const deviceUuid = req.headers["device-uuid"] as string | undefined;
  if (!deviceUuid || !genericUuidRegex.test(deviceUuid)) {
    logger.warn(
      i18next.t("user.signInUser.validators.logs.deviceUuidMissing", {
        uuid: deviceUuid,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.signInUser.validators.deviceUuidMissing"),
    );
    return;
  }

  if (typeof email !== "string") {
    logger.warn(
      i18next.t("user.signInUser.validators.logs.invalidEmail", { email }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.signInUser.validators.invalidEmail"),
    );
    return;
  }

  const sanitizedEmail = email.trim().toLowerCase();

  if (!emailRegex.test(sanitizedEmail)) {
    logger.warn(
      i18next.t("user.signInUser.validators.logs.invalidEmail", {
        email: sanitizedEmail,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.signInUser.validators.invalidEmail"),
    );
    return;
  }

  if (typeof password !== "string" || password.length < 1) {
    logger.warn(i18next.t("user.signInUser.validators.logs.invalidPassword"));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("user.signInUser.validators.invalidPassword"),
    );
    return;
  }

  const validatedBody: SignInUserRequestModel = {
    email: sanitizedEmail,
    password,
    deviceUuid,
  };
  req.body = validatedBody;

  next();
}
