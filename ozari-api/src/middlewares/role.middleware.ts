import type { NextFunction, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

export const isGrantedRoles =
  (allowedRoles: RolesEnum[]) =>
  (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.error(
        i18next.t("middlewares.isGranted.logs.unauthorized", {
          user: req.user,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("middlewares.isGranted.defaultMessage"),
      );
      return;
    }

    const userPayload = req.user;

    if (!allowedRoles.includes(userPayload.userRole)) {
      logger.error(
        i18next.t("middlewares.isGranted.logs.forbidden", {
          method: req.method,
          role: RolesEnum[userPayload.userRole],
          url: req.originalUrl,
          userId: userPayload.userId,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.FORBIDDEN,
        i18next.t("middlewares.isGranted.defaultMessage"),
      );
      return;
    }

    next();
  };
