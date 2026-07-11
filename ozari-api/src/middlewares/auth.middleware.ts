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

/**
 * The user's CURRENT role, taken from the DB session's joined user (source of truth), falling back to
 * the token claim only if the relation is somehow absent (unreachable — a session always has a user).
 * Kept as a tiny helper so the `?.`/`??` branches don't inflate `verifyJwt`'s cyclomatic complexity.
 */
const resolveCurrentRole = (
  session: { user: { roleId: number } } | undefined,
  fallback: RolesEnum,
): RolesEnum => session?.user.roleId ?? fallback;

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
      // Fold the user's CURRENT role into this existing session lookup (no extra query): the DB is
      // the source of truth, so a role that was changed/revoked in the DB is enforced on the very
      // next request instead of being trusted from the (possibly stale) JWT claim. `isGrantedRoles`
      // reads `req.user.userRole`, which we set from this below.
      include: { user: { select: { roleId: true } } },
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

    // The DB role wins over the token claim (see the `include` above), so a mid-session role change
    // takes effect immediately.
    const currentRole = resolveCurrentRole(jwtActiveTokens[0], jwtPayload.userRole);
    req.user = { ...jwtPayload, userRole: currentRole };
    logger.info(
      i18next.t("middlewares.auth.logs.successAuth", {
        role: RolesEnum[currentRole],
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
