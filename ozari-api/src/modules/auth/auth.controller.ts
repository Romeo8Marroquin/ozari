import type { Request, Response } from "express";
import crypto from "node:crypto";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import jwt from "jsonwebtoken";
import {
  comparePassword,
  decryptKms,
  encryptKms,
  encryptSha256Sync,
  hashPassword,
} from "@helpers/encryption.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import {
  AuditAction,
  logAuthAudit,
  logSecurityAudit,
  logUserManagementAudit,
} from "@/config/auditLogger.js";
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
import { setCsrfToken } from "@middlewares/csrf.middleware.js";
import {
  type ChangePasswordRequestModel,
  type CreateUserRequestModel,
  type SignInUserRequestModel,
} from "./auth.models.js";
import { issueAuthenticatedSession } from "./auth.service.js";

// Constant-time guard against account enumeration. On the "user not found" path we
// still run one bcrypt comparison against this fixed hash so the response time matches
// the "wrong password" path (which runs bcrypt). Computed once per process, reused.
let timingEqualizerHash: Promise<string> | undefined;
const getTimingEqualizerHash = (): Promise<string> =>
  (timingEqualizerHash ??= hashPassword("account-enumeration-timing-guard"));

export const getAllUsers = async (_: Request, res: Response): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });

    const emails = decryptKms(users.map((user) => user.emailKms));
    const fullNames = decryptKms(users.map((user) => user.fullNameKms));

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
    const encryptedName = encryptKms(fullName);
    const encryptedEmail = encryptKms(email);
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
    if (isDeployedEnvironment()) {
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
      // Run a throwaway bcrypt compare so this path costs the same as the
      // invalid-password path below, preventing account enumeration via timing.
      await comparePassword(password, await getTimingEqualizerHash());
      logger.warn(i18next.t("user.signInUser.logs.userNotFound", { email }));
      recordFailedLogin(email);
      if (isDeployedEnvironment()) {
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
      recordFailedLogin(email);
      if (isDeployedEnvironment()) {
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

    if (user.mfaEnabledAt) {
      const mfaToken = jwt.sign(
        {
          iat: Math.floor(Date.now() / 1000),
          deviceUuid,
          tokenType: TokenEnum.MFA_TOKEN,
          userId: user.id,
        },
        jwtSecret,
        appConfig.mfaToken as jwt.SignOptions,
      );
      clearLoginAttempts(email);
      logger.info(
        i18next.t("user.signInUser.logs.mfaRequired", { userId: user.id }),
      );
      sendOzariSuccess(
        res,
        HttpEnum.OK,
        i18next.t("user.signInUser.mfaRequired"),
        { mfaRequired: true, mfaToken },
      );
      return;
    }

    await issueAuthenticatedSession(prismaClient, res, {
      userId: user.id,
      userRole: user.roleId,
      deviceUuid,
    });
    clearLoginAttempts(email);

    logger.info(
      i18next.t("user.signInUser.logs.userAuthenticated", { userId: user.id }),
    );
    if (isDeployedEnvironment()) {
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
  const genericErrorKey = "user.refreshToken.genericError";
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
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }
    const payload = jwt.verify(refreshToken, jwtRefreshSecret, {
      algorithms: [appConfig.refreshToken.algorithm],
      audience: appConfig.refreshToken.audience,
      issuer: appConfig.refreshToken.issuer,
    }) as UserJwtPayloadModel;
    if (payload.tokenType !== TokenEnum.REFRESH_TOKEN) {
      logger.error(
        i18next.t("user.refreshToken.logs.invalidTokenType", {
          expected: TokenEnum[TokenEnum.REFRESH_TOKEN],
          received: TokenEnum[payload.tokenType],
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }
    // Each device has exactly one active refresh session. Look it up by DEVICE (not
    // by jti) so we can distinguish the device's current token from a previously
    // rotated one.
    const currentRefresh = await prismaClient.jwtSession.findFirst({
      where: {
        deviceUuid: payload.deviceUuid,
        userId: payload.userId,
        tokenTypeId: TokenEnum.REFRESH_TOKEN,
        isActive: true,
      },
    });

    // No active session for this device (e.g. already signed out) -> nothing to do.
    if (!currentRefresh) {
      logger.warn(i18next.t("user.refreshToken.logs.noRefreshToken"));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }

    // Reuse detection: the token is validly signed but is NOT the device's current
    // refresh token -> a previously-rotated token is being replayed (likely theft).
    // Hard-delete every session for the user (fail secure, leaves no tombstone
    // garbage so we never depend on a cleanup job running under scale-to-zero).
    if (currentRefresh.jti !== payload.jti) {
      logger.error(
        i18next.t("user.refreshToken.logs.tokenReuseDetected", {
          jti: payload.jti,
          userId: payload.userId,
        }),
      );
      await prismaClient.jwtSession.deleteMany({
        where: { userId: payload.userId },
      });
      if (isDeployedEnvironment()) {
        logSecurityAudit({
          action: AuditAction.UNAUTHORIZED_ACCESS_ATTEMPT,
          userId: payload.userId,
          ipAddress: req.ip,
          success: false,
          reason: "Refresh token reuse detected - all sessions invalidated",
          metadata: { deviceUuid: payload.deviceUuid },
        });
      }
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }

    // Defensive: jwt.verify already enforced the token's exp claim, but the DB row
    // carries the authoritative session lifetime.
    if (currentRefresh.expiresAt <= new Date()) {
      logger.warn(
        i18next.t("user.refreshToken.logs.sessionExpired", {
          jti: currentRefresh.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessExp = now + appConfig.accessToken.expiresIn;
    const refreshExp = now + appConfig.refreshToken.expiresIn;

    const accessToken = jwt.sign(
      {
        deviceUuid: payload.deviceUuid,
        jti: accessJti,
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      },
      jwtSecret,
      appConfig.accessToken as jwt.SignOptions,
    );
    const newValidRefreshToken = jwt.sign(
      {
        deviceUuid: payload.deviceUuid,
        jti: refreshJti,
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      },
      jwtRefreshSecret,
      appConfig.refreshToken as jwt.SignOptions,
    );

    // Rotate atomically. Lock the device's active refresh row; if it changed out
    // from under us (a concurrent refresh of the SAME token won the race), treat it
    // as a harmless retry (401) rather than theft.
    let rotatedConcurrently = false;
    await prismaClient.$transaction(async (transaction) => {
      const lockedSession = await transaction.$queryRaw<Array<{ jti: string }>>`
        SELECT jti
        FROM jwt_sessions
        WHERE device_uuid = ${payload.deviceUuid}
          AND user_id = ${payload.userId}
          AND token_type_id = ${TokenEnum.REFRESH_TOKEN}
          AND is_active = true
        FOR UPDATE
      `;

      if (lockedSession[0]?.jti !== payload.jti) {
        rotatedConcurrently = true;
        return;
      }

      await transaction.jwtSession.deleteMany({
        where: {
          deviceUuid: payload.deviceUuid,
          isActive: true,
          userId: payload.userId,
        },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid: payload.deviceUuid,
            expiresAt: new Date(accessExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: accessJti,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: payload.userId,
          },
          {
            deviceUuid: payload.deviceUuid,
            expiresAt: new Date(refreshExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: refreshJti,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: payload.userId,
          },
        ],
      });
    });

    if (rotatedConcurrently) {
      logger.warn(
        `Concurrent refresh for user ${payload.userId} on device ${payload.deviceUuid}; treating as retry`,
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }

    // Rotate CSRF token on refresh
    setCsrfToken(res);

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
    if (isDeployedEnvironment()) {
      logAuthAudit({
        action: AuditAction.TOKEN_REFRESH,
        userId: payload.userId,
        email: "", // Email not available in refresh token flow
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceUuid: payload.deviceUuid,
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
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
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
    const jwtRefreshSecret = process.env["JWT_REFRESH_SECRET"];
    const allDevices =
      (req.query?.["allDevices"] as string | undefined) === "true";

    const refreshToken = req.cookies["refresh-token"] as string | undefined;
    let identity: UserJwtPayloadModel | null = null;

    // Identity comes from the refresh token (the session anchor), verified with
    // ignoreExpiration so logout works even when the access token has expired.
    if (refreshToken && jwtRefreshSecret) {
      try {
        const payload = jwt.verify(refreshToken, jwtRefreshSecret, {
          algorithms: [appConfig.refreshToken.algorithm],
          audience: appConfig.refreshToken.audience,
          issuer: appConfig.refreshToken.issuer,
          ignoreExpiration: true,
        }) as UserJwtPayloadModel;
        if (payload.tokenType === TokenEnum.REFRESH_TOKEN) {
          identity = payload;
        }
      } catch {
        identity = null;
      }
    }

    if (identity) {
      const { deviceUuid, userId, userRole } = identity;
      await prismaClient.jwtSession.deleteMany({
        where: allDevices
          ? { isActive: true, userId }
          : { deviceUuid, isActive: true, userId },
      });
      logger.info(
        i18next.t("user.signOutUser.logs.userSignedOut", {
          allDevices,
          userId,
          userRole,
        }),
      );
      if (isDeployedEnvironment()) {
        logAuthAudit({
          action: allDevices
            ? AuditAction.USER_LOGOUT_ALL_DEVICES
            : AuditAction.USER_LOGOUT,
          userId,
          email: "",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceUuid,
          success: true,
        });
      }
    }

    // Logout is idempotent: always clear client credentials and succeed. The CSRF token
    // is stateless (no cookie) — the client drops its stored copy on signout.
    res.clearCookie("refresh-token", appConfig.cookieConfig);

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

export const getMe = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const { userId } = req.user as UserJwtPayloadModel;

    const user = await prismaClient.user.findFirst({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      logger.warn(i18next.t("user.getMe.logs.userNotFound", { userId }));
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("user.getMe.genericError"),
      );
      return;
    }

    sendOzariSuccess(res, HttpEnum.OK, i18next.t("user.getMe.profileFetched"), {
      id: user.id,
      email: decryptKms(user.emailKms),
      fullName: decryptKms(user.fullNameKms),
      role: RolesEnum[user.roleId],
      mfaEnabled: user.mfaEnabledAt !== null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt ?? undefined,
    });
  } catch (error) {
    logger.error(i18next.t("user.getMe.logs.internalServerError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.getMe.genericError"),
    );
  }
};

export const changePassword = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const { userId, deviceUuid } = req.user as UserJwtPayloadModel;
    const { currentPassword, newPassword } =
      req.body as ChangePasswordRequestModel;

    const user = await prismaClient.user.findFirst({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("user.changePassword.genericError"),
      );
      return;
    }

    const currentValid = await comparePassword(
      currentPassword,
      user.passwordSha,
    );
    if (!currentValid) {
      logger.warn(
        i18next.t("user.changePassword.logs.invalidCurrentPassword", {
          userId,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.UNAUTHORIZED,
        i18next.t("user.changePassword.invalidCurrentPassword"),
      );
      return;
    }

    const reusedPassword = await comparePassword(newPassword, user.passwordSha);
    if (reusedPassword) {
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.changePassword.passwordReused"),
      );
      return;
    }

    const passwordSha = await hashPassword(newPassword);

    // Update the password and revoke every session except the current device,
    // so a stolen session elsewhere cannot survive a password change.
    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: userId },
        data: { passwordSha },
      }),
      prismaClient.jwtSession.deleteMany({
        where: { userId, isActive: true, deviceUuid: { not: deviceUuid } },
      }),
    ]);

    logger.info(
      i18next.t("user.changePassword.logs.passwordChanged", { userId }),
    );
    if (isDeployedEnvironment()) {
      logSecurityAudit({
        action: AuditAction.PASSWORD_CHANGED,
        userId,
        ipAddress: req.ip,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.changePassword.passwordChanged"),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.changePassword.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.changePassword.genericError"),
    );
  }
};
