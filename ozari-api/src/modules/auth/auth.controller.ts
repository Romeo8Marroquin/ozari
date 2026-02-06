import type { Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import jwt from "jsonwebtoken";
import {
  comparePassword,
  decryptKmsAsync,
  encryptKmsAsync,
  encryptSha256Sync,
  hashPassword,
} from "@helpers/encryption.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import {
  AuditAction,
  logAuthAudit,
  logUserManagementAudit,
} from "@/config/auditLogger.js";
import { type JwtPayloadModel } from "@models/common/authModel.js";
import {
  type CustomRequest,
  type UserJwtPayloadModel,
} from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { appConfig } from "@/config/app.js";
import {
  clearLoginAttempts,
  recordFailedLogin,
} from "@middlewares/loginRateLimit.middleware.js";
import {
  type CreateUserRequestModel,
  type SignInUserRequestModel,
} from "./auth.models.js";

export const getAllUsers = async (_: Request, res: Response): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });

    const [emails, fullNames] = await Promise.all([
      decryptKmsAsync(users.map((user) => user.emailKms)),
      decryptKmsAsync(users.map((user) => user.fullNameKms)),
    ]);

    logger.info(
      i18next.t("user.getAllUsers.logs.usersFetched", { count: users.length }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.getAllUsers.usersFetched"),
      users.map((user, index) => ({
        createdAt: user.createdAt,
        email: emails[index],
        fullName: fullNames[index],
        id: user.id,
        role: RolesEnum[user.roleId],
        updatedAt: user.updatedAt ?? undefined,
      })),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.getAllUsers.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.getAllUsers.genericError"),
    );
  }
};

export const createUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const { email, fullName, password, termsAccepted } =
      req.body as CreateUserRequestModel;
    const emailSha = encryptSha256Sync(email);
    const existingUser = await prismaClient.user.findUnique({
      where: { emailSha },
    });
    if (existingUser) {
      logger.warn(
        i18next.t("user.createUser.logs.userAlreadyExists", { email }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("user.createUser.genericError"),
      );
      return;
    }
    const encryptedName = await encryptKmsAsync(fullName);
    const encryptedEmail = await encryptKmsAsync(email);
    const hashedPassword = await hashPassword(password);
    const newUser = await prismaClient.user.create({
      data: {
        emailKms: encryptedEmail,
        emailSha,
        fullNameKms: encryptedName,
        passwordSha: hashedPassword,
        roleId: RolesEnum.Client,
        termsAccepted,
      },
    });

    logger.info(i18next.t("user.createUser.logs.userCreated", { email }));

    // Audit log: User created
    if (process.env["NODE_ENV"] === "production") {
      logUserManagementAudit({
        action: AuditAction.USER_CREATED,
        userId: newUser.id,
        email,
        ipAddress: req.ip,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.CREATED,
      i18next.t("user.createUser.userCreated"),
    );
  } catch (error) {
    logger.error(i18next.t("user.createUser.logs.internalServerError"), error);
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.createUser.genericError"),
    );
  }
};

export const signInUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email, password, deviceUuid } = req.body as SignInUserRequestModel;

  try {
    const prismaClient = await getPrismaClient();
    const jwtSecret = process.env["JWT_SECRET"];
    const jwtRefreshSecret = process.env["JWT_REFRESH_SECRET"];

    if (!jwtSecret || !jwtRefreshSecret) {
      logger.error("JWT secrets not configured in environment");
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("user.signInUser.internalServerError"),
      );
      return;
    }

    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findFirst({
      where: { emailSha, isActive: true },
    });
    if (!user) {
      logger.warn(i18next.t("user.signInUser.logs.userNotFound", { email }));
      // Record failed login attempt for non-existent user (prevent enumeration timing attacks)
      recordFailedLogin(email);

      // Audit log: Failed login (user not found)
      if (process.env["NODE_ENV"] === "production") {
        logAuthAudit({
          action: AuditAction.USER_LOGIN_FAILED,
          email,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceUuid,
          success: false,
          reason: "User not found",
        });
      }

      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.signInUser.genericError"),
      );
      return;
    }

    const passwordValid = await comparePassword(password, user.passwordSha);
    if (!passwordValid) {
      logger.warn(
        i18next.t("user.signInUser.logs.invalidCredentials", {
          userId: user.id,
        }),
      );
      // Record failed login attempt for invalid password
      recordFailedLogin(email);

      // Audit log: Failed login (invalid password)
      if (process.env["NODE_ENV"] === "production") {
        logAuthAudit({
          action: AuditAction.USER_LOGIN_FAILED,
          userId: user.id,
          email,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceUuid,
          success: false,
          reason: "Invalid password",
        });
      }

      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.signInUser.genericError"),
      );
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessExp = now + appConfig.accessToken.expiresIn;
    const refreshExp = now + appConfig.refreshToken.expiresIn;

    const accessToken = jwt.sign(
      {
        jti: accessJti,
        iat: now,
        deviceUuid,
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtSecret,
      appConfig.accessToken as jwt.SignOptions,
    );
    const refreshToken = jwt.sign(
      {
        jti: refreshJti,
        iat: now,
        deviceUuid,
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      appConfig.refreshToken as jwt.SignOptions,
    );

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.deleteMany({
        where: { deviceUuid, isActive: true, userId: user.id },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid,
            expiresAt: new Date(accessExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: accessJti,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: user.id,
          },
          {
            deviceUuid,
            expiresAt: new Date(refreshExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: refreshJti,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: user.id,
          },
        ],
      });
    });

    res
      .header("authorization", `Bearer ${accessToken}`)
      .cookie("refresh-token", refreshToken, appConfig.cookieConfig);

    // Clear failed login attempts on successful authentication
    clearLoginAttempts(email);

    logger.info(
      i18next.t("user.signInUser.logs.userAuthenticated", { userId: user.id }),
    );

    // Audit log: Successful login
    if (process.env["NODE_ENV"] === "production") {
      logAuthAudit({
        action: AuditAction.USER_LOGIN_SUCCESS,
        userId: user.id,
        email,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceUuid,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.signInUser.userAuthenticated"),
    );
  } catch (error) {
    logger.error(i18next.t("user.signInUser.logs.internalServerError"), error);
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.signInUser.internalServerError"),
    );
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const jwtSecret = process.env["JWT_SECRET"];
    const jwtRefreshSecret = process.env["JWT_REFRESH_SECRET"];

    if (!jwtSecret || !jwtRefreshSecret) {
      logger.error("JWT secrets not configured in environment");
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("user.refreshToken.internalServerError"),
      );
      return;
    }

    const refreshToken = req.cookies["refresh-token"] as string | undefined;
    if (!refreshToken) {
      logger.warn(i18next.t("user.refreshToken.logs.noRefreshToken"));
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.refreshToken.genericError"),
      );
      return;
    }
    const payload = jwt.verify(
      refreshToken,
      jwtRefreshSecret,
    ) as UserJwtPayloadModel;
    if (payload.tokenType !== TokenEnum.REFRESH_TOKEN) {
      logger.error(
        i18next.t("user.refreshToken.logs.invalidTokenType", {
          expected: TokenEnum[TokenEnum.REFRESH_TOKEN],
          received: TokenEnum[payload.tokenType],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.refreshToken.genericError"),
      );
      return;
    }
    const foundSession = await prismaClient.jwtSession.findFirst({
      where: {
        jti: payload.jti,
        deviceUuid: payload.deviceUuid,
        tokenTypeId: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!foundSession) {
      logger.error(i18next.t("user.refreshToken.logs.noRefreshToken"));
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.refreshToken.genericError"),
      );
      return;
    }

    if (foundSession.expiresAt <= new Date()) {
      logger.warn(
        i18next.t("user.refreshToken.logs.sessionExpired", {
          jti: foundSession.jti,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.refreshToken.genericError"),
      );
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessExp = now + appConfig.accessToken.expiresIn;
    const refreshExp = now + appConfig.refreshToken.expiresIn;

    const accessToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: accessJti,
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      } as UserJwtPayloadModel,
      jwtSecret,
      appConfig.accessToken as jwt.SignOptions,
    );
    const newValidRefreshToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: refreshJti,
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      appConfig.refreshToken as jwt.SignOptions,
    );

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.deleteMany({
        where: {
          deviceUuid: foundSession.deviceUuid,
          isActive: true,
          userId: payload.userId,
        },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid: foundSession.deviceUuid,
            expiresAt: new Date(accessExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: accessJti,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: payload.userId,
          },
          {
            deviceUuid: foundSession.deviceUuid,
            expiresAt: new Date(refreshExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: refreshJti,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: payload.userId,
          },
        ],
      });
    });

    res
      .header("authorization", `Bearer ${accessToken}`)
      .cookie("refresh-token", newValidRefreshToken, appConfig.cookieConfig);

    logger.info(
      i18next.t("user.refreshToken.logs.tokenRefreshed", {
        userId: payload.userId,
        userRole: payload.userRole,
      }),
    );

    // Audit log: Token refreshed
    if (process.env["NODE_ENV"] === "production") {
      logAuthAudit({
        action: AuditAction.TOKEN_REFRESH,
        userId: payload.userId,
        email: "", // Email not available in refresh token flow
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceUuid: foundSession.deviceUuid,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.refreshToken.tokenRefreshed"),
    );
  } catch (error) {
    if (
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.JsonWebTokenError
    ) {
      logger.warn(
        i18next.t("user.refreshToken.logs.sessionExpiredOrInvalid"),
        error,
      );
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.refreshToken.genericError"),
      );
      return;
    }

    logger.error(
      i18next.t("user.refreshToken.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.refreshToken.internalServerError"),
    );
  }
};

export const signOutUser = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const allDevices =
      (req.query?.["allDevices"] as string | undefined) === "true";
    const { deviceUuid, userId, userRole } = req.user as JwtPayloadModel;
    if (allDevices) {
      await prismaClient.jwtSession.deleteMany({
        where: { isActive: true, userId },
      });
    } else {
      await prismaClient.jwtSession.deleteMany({
        where: { deviceUuid, isActive: true, userId },
      });
    }
    res.clearCookie("refresh-token", appConfig.cookieConfig);
    logger.info(
      i18next.t("user.signOutUser.logs.userSignedOut", {
        allDevices,
        userId,
        userRole,
      }),
    );

    // Audit log: User logout
    if (process.env["NODE_ENV"] === "production") {
      logAuthAudit({
        action: allDevices
          ? AuditAction.USER_LOGOUT_ALL_DEVICES
          : AuditAction.USER_LOGOUT,
        userId,
        email: "", // Email not available in logout flow
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceUuid,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.signOutUser.userSignedOut"),
    );
  } catch (error) {
    logger.error(i18next.t("user.signOutUser.logs.internalServerError"), error);
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.signOutUser.genericError"),
    );
  }
};
