import type { NextFunction, Response } from "express";
import { i18next } from "@/config/i18n.js";
import jwt from "jsonwebtoken";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { type JwtPayloadModel } from "@models/common/authModel.js";
import {
  type CustomRequest,
  type MfaTokenPayloadModel,
} from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { appConfig } from "@/config/app.js";

export const verifyJwt = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
) => {
  const defaultMessageKey = "middlewares.auth.defaultMessage";
  try {
    const jwtSecret = process.env["JWT_SECRET"];

    if (!jwtSecret) {
      logger.error("JWT_SECRET environment variable is not defined");
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("middlewares.auth.internalServerError"),
      );
      return;
    }

    const token = req.header("Authorization")?.split(" ")[1];
    if (!token) {
      logger.warn(i18next.t("middlewares.auth.logs.unauthorized"));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    const jwtPayload = jwt.verify(token, jwtSecret, {
      algorithms: [appConfig.accessToken.algorithm],
      audience: appConfig.accessToken.audience,
      issuer: appConfig.accessToken.issuer,
    }) as JwtPayloadModel;

    if (jwtPayload.tokenType !== TokenEnum.ACCESS_TOKEN) {
      logger.error(
        i18next.t("middlewares.auth.logs.invalidTokenType", {
          expected: TokenEnum[TokenEnum.ACCESS_TOKEN],
          received: TokenEnum[jwtPayload.tokenType],
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    const prismaClient = await getPrismaClient();
    const jwtActiveTokens = await prismaClient.jwtSession.findMany({
      where: {
        deviceUuid: jwtPayload.deviceUuid,
        isActive: true,
        tokenTypeId: TokenEnum.ACCESS_TOKEN,
        userId: jwtPayload.userId,
      },
    });

    if (jwtActiveTokens.length !== 1) {
      logger.error(
        i18next.t("middlewares.auth.logs.jwtRegisterError", {
          count: jwtActiveTokens.length,
          jti: jwtPayload.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    if (jwtActiveTokens[0]?.jti !== jwtPayload.jti) {
      logger.error(
        i18next.t("middlewares.auth.logs.jwtMismatch", {
          expected: jwtActiveTokens[0]?.jti,
          received: jwtPayload.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    if (jwtActiveTokens[0]?.expiresAt <= new Date()) {
      logger.error(
        i18next.t("middlewares.auth.logs.sessionExpired", {
          jti: jwtPayload.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    req.user = jwtPayload;
    logger.info(
      i18next.t("middlewares.auth.logs.successAuth", {
        role: RolesEnum[jwtPayload.userRole],
        userId: jwtPayload.userId,
      }),
    );
    next();
  } catch (error) {
    if (
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.JsonWebTokenError
    ) {
      logger.warn(i18next.t("middlewares.auth.logs.unauthorized"), error);
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    logger.error(
      i18next.t("middlewares.auth.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("middlewares.auth.internalServerError"),
    );
  }
};

export const verifyMfaChallengeToken = (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): void => {
  const defaultMessageKey = "middlewares.mfa.defaultMessage";
  try {
    const jwtSecret = process.env["JWT_SECRET"];
    if (!jwtSecret) {
      logger.error("JWT_SECRET environment variable is not defined");
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("middlewares.mfa.internalServerError"),
      );
      return;
    }

    const token = req.header("Authorization")?.split(" ")[1];
    if (!token) {
      logger.warn(i18next.t("middlewares.mfa.logs.unauthorized"));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    const payload = jwt.verify(token, jwtSecret, {
      algorithms: [appConfig.mfaToken.algorithm],
      audience: appConfig.mfaToken.audience,
      issuer: appConfig.mfaToken.issuer,
    }) as MfaTokenPayloadModel;

    if (payload.tokenType !== TokenEnum.MFA_TOKEN) {
      logger.warn(i18next.t("middlewares.mfa.logs.invalidTokenType"));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    req.mfaToken = payload;
    next();
  } catch (error) {
    if (
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.JsonWebTokenError
    ) {
      logger.warn(i18next.t("middlewares.mfa.logs.unauthorized"), error);
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(defaultMessageKey));
      return;
    }

    logger.error(
      i18next.t("middlewares.mfa.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("middlewares.mfa.internalServerError"),
    );
  }
};
