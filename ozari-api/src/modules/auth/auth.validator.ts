import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { emailRegex, fullNameRegex, passwordRegex } from "@helpers/regex.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  type CreateUserRequestModel,
  type SignInUserRequestModel,
} from "./auth.models.js";

// Zod schemas for validation
const createUserSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Full name is required")
      .regex(fullNameRegex, "Full name format is invalid"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(emailRegex, "Email format is invalid"),
    password: z.string().regex(passwordRegex, "Password format is invalid"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
    termsAccepted: z
      .boolean()
      .refine((val) => val === true, "Terms must be accepted"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(emailRegex, "Email format is invalid"),
  password: z.string().min(1, "Password is required"),
  deviceUuid: z.string().uuid("Device UUID format is invalid"),
});

export function validateCreateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Check if body exists and is an object
  if (!req.body || typeof req.body !== "object") {
    logger.warn(i18next.t("common.logs.invalidBody"));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("common.invalidBody"));
    return;
  }

  // Validate using Zod schema
  const result = createUserSchema.safeParse(req.body);

  if (!result.success) {
    // Get first validation error
    const firstError = result.error.errors[0];
    if (!firstError) {
      logger.warn(i18next.t("common.logs.invalidBody"));
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("common.invalidBody"),
      );
      return;
    }
    const field = firstError.path[0] as string;

    // Map Zod errors to existing i18n messages
    let translationKey: string;
    let logTranslationKey: string;

    switch (field) {
      case "fullName":
        translationKey = "user.createUser.validators.invalidFullName";
        logTranslationKey = "user.createUser.validators.logs.invalidFullName";
        logger.warn(
          i18next.t(logTranslationKey, { fullName: req.body.fullName }),
        );
        break;
      case "email":
        translationKey = "user.createUser.validators.invalidEmail";
        logTranslationKey = "user.createUser.validators.logs.invalidEmail";
        logger.warn(i18next.t(logTranslationKey, { email: req.body.email }));
        break;
      case "password":
        translationKey = "user.createUser.validators.invalidPassword";
        logTranslationKey = "user.createUser.validators.logs.invalidPassword";
        logger.warn(i18next.t(logTranslationKey));
        break;
      case "confirmPassword":
        if (firstError.message === "Passwords do not match") {
          translationKey = "user.createUser.validators.passwordsDoNotMatch";
          logTranslationKey =
            "user.createUser.validators.logs.passwordsDoNotMatch";
        } else {
          translationKey =
            "user.createUser.validators.invalidConfirmPassword";
          logTranslationKey =
            "user.createUser.validators.logs.invalidConfirmPassword";
        }
        logger.warn(i18next.t(logTranslationKey));
        break;
      case "termsAccepted":
        translationKey = "user.createUser.validators.termsNotAccepted";
        logTranslationKey = "user.createUser.validators.logs.termsNotAccepted";
        logger.warn(
          i18next.t(logTranslationKey, {
            termsAccepted: req.body.termsAccepted,
          }),
        );
        break;
      default:
        translationKey = "common.invalidBody";
        logger.warn(i18next.t("common.logs.invalidBody"));
    }

    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(translationKey));
    return;
  }

  // Set validated and sanitized body
  req.body = result.data as CreateUserRequestModel;
  next();
}

export function validateSignIn(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Check if body exists and is an object
  if (!req.body || typeof req.body !== "object") {
    logger.warn(i18next.t("common.logs.invalidBody"));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("common.invalidBody"));
    return;
  }

  // Get device UUID from headers
  const deviceUuid = req.headers["device-uuid"] as string | undefined;

  // Validate using Zod schema
  const result = signInSchema.safeParse({
    ...req.body,
    deviceUuid,
  });

  if (!result.success) {
    // Get first validation error
    const firstError = result.error.errors[0];
    if (!firstError) {
      logger.warn(i18next.t("common.logs.invalidBody"));
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("common.invalidBody"),
      );
      return;
    }
    const field = firstError.path[0] as string;

    // Map Zod errors to existing i18n messages
    let translationKey: string;
    let logTranslationKey: string;

    switch (field) {
      case "deviceUuid":
        translationKey = "user.signInUser.validators.deviceUuidMissing";
        logTranslationKey =
          "user.signInUser.validators.logs.deviceUuidMissing";
        logger.warn(i18next.t(logTranslationKey, { uuid: deviceUuid }));
        break;
      case "email":
        translationKey = "user.signInUser.validators.invalidEmail";
        logTranslationKey = "user.signInUser.validators.logs.invalidEmail";
        logger.warn(i18next.t(logTranslationKey, { email: req.body.email }));
        break;
      case "password":
        translationKey = "user.signInUser.validators.invalidPassword";
        logTranslationKey = "user.signInUser.validators.logs.invalidPassword";
        logger.warn(i18next.t(logTranslationKey));
        break;
      default:
        translationKey = "common.invalidBody";
        logger.warn(i18next.t("common.logs.invalidBody"));
    }

    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(translationKey));
    return;
  }

  // Set validated and sanitized body (without deviceUuid since it's from headers)
  const { deviceUuid: validatedDeviceUuid, ...bodyData } = result.data;
  req.body = {
    ...bodyData,
    deviceUuid: validatedDeviceUuid,
  } as SignInUserRequestModel;

  next();
}
