import type { Response } from "express";
import { appConfig } from "@/config/app.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAuthAudit } from "@/config/auditLogger.js";
import {
  comparePassword,
  decryptKms,
  encryptKms,
  encryptSha256Sync,
} from "@helpers/encryption.js";
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  getTotpStep,
  verifyTotp,
} from "@helpers/totp.js";
import { getMailer } from "@helpers/mailer.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import {
  clearMfaAttempts,
  recordFailedMfa,
} from "@middlewares/mfaRateLimit.middleware.js";
import {
  buildMfaDisabledEmail,
  buildMfaEnabledEmail,
} from "../../emails/securityEmail.js";
import {
  type CustomRequest,
  type MfaTokenPayloadModel,
  type UserJwtPayloadModel,
} from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import {
  type MfaCodeRequestModel,
  type MfaDisableRequestModel,
} from "./auth.models.js";
import { issueAuthenticatedSession } from "./auth.service.js";

// eslint-disable-next-line security/detect-non-literal-regexp -- digit count comes from trusted app config, not user input
const TOTP_CODE_PATTERN = new RegExp(`^\\d{${appConfig.mfa.totpDigits}}$`);

function stepToDate(step: number): Date {
  return new Date(step * appConfig.mfa.totpStepSeconds * 1000);
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export const setupMfa = async (
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
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("user.mfaSetup.genericError"),
      );
      return;
    }

    if (user.mfaEnabledAt) {
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("user.mfaSetup.alreadyEnabled"),
      );
      return;
    }

    const secret = generateTotpSecret();
    await prismaClient.user.update({
      where: { id: userId },
      data: { mfaSecretKms: encryptKms(secret) },
    });

    const otpauthUri = buildOtpauthUri(secret, decryptKms(user.emailKms));

    logger.info(i18next.t("user.mfaSetup.logs.secretGenerated", { userId }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("user.mfaSetup.secretGenerated"), {
      secret,
      otpauthUri,
    });
  } catch (error) {
    logger.error(i18next.t("user.mfaSetup.logs.internalServerError", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.mfaSetup.genericError"),
    );
  }
};

export const enableMfa = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const { userId } = req.user as UserJwtPayloadModel;
    const { code } = req.body as MfaCodeRequestModel;

    const user = await prismaClient.user.findFirst({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("user.mfaEnable.genericError"),
      );
      return;
    }

    if (user.mfaEnabledAt) {
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("user.mfaEnable.alreadyEnabled"),
      );
      return;
    }

    if (!user.mfaSecretKms) {
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.mfaEnable.setupRequired"),
      );
      return;
    }

    const { valid, step } = verifyTotp(decryptKms(user.mfaSecretKms), code);
    if (!valid) {
      logger.warn(i18next.t("user.mfaEnable.logs.invalidCode", { userId }));
      // 422 (not 401): the caller IS authenticated (valid access token) — it's the
      // submitted code that's wrong. A 401 here would tell the client its session is
      // stale and trigger a spurious token refresh + retry of the same bad code.
      sendOzariError(
        res,
        HttpEnum.UNPROCESSABLE_ENTITY,
        i18next.t("user.mfaEnable.invalidCode"),
      );
      return;
    }

    const recoveryCodes = generateRecoveryCodes();
    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: userId },
        data: { mfaEnabledAt: new Date(), mfaLastUsedAt: stepToDate(step) },
      }),
      prismaClient.mfaRecoveryCode.deleteMany({ where: { userId } }),
      prismaClient.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId,
          codeSha: encryptSha256Sync(recoveryCode),
        })),
      }),
    ]);

    logger.info(i18next.t("user.mfaEnable.logs.mfaEnabled", { userId }));
    if (isDeployedEnvironment()) {
      logAuthAudit({
        action: AuditAction.MFA_ENABLED,
        userId,
        email: "",
        ipAddress: req.ip,
        success: true,
      });
    }

    // Best-effort security notification — a send failure is logged, never fails the request.
    try {
      await getMailer().send(
        buildMfaEnabledEmail({
          to: decryptKms(user.emailKms),
          name: decryptKms(user.fullNameKms),
        }),
      );
    } catch (emailError) {
      logger.error(
        i18next.t("user.mfaEnable.logs.securityEmailFailed", {
          userId,
          error: String(emailError),
        }),
      );
    }

    sendOzariSuccess(res, HttpEnum.OK, i18next.t("user.mfaEnable.mfaEnabled"), {
      recoveryCodes,
    });
  } catch (error) {
    logger.error(
      i18next.t("user.mfaEnable.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.mfaEnable.genericError"),
    );
  }
};

export const disableMfa = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const { userId } = req.user as UserJwtPayloadModel;
    const { password } = req.body as MfaDisableRequestModel;

    const user = await prismaClient.user.findFirst({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("user.mfaDisable.genericError"),
      );
      return;
    }

    if (!user.mfaEnabledAt) {
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.mfaDisable.notEnabled"),
      );
      return;
    }

    const passwordValid = await comparePassword(password, user.passwordSha);
    if (!passwordValid) {
      logger.warn(i18next.t("user.mfaDisable.logs.invalidPassword", { userId }));
      // 422 (not 401): the session is valid; the confirming password is wrong. Keeps the
      // client from misreading this as an expired access token and refreshing.
      sendOzariError(
        res,
        HttpEnum.UNPROCESSABLE_ENTITY,
        i18next.t("user.mfaDisable.invalidPassword"),
      );
      return;
    }

    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: userId },
        data: { mfaSecretKms: null, mfaEnabledAt: null, mfaLastUsedAt: null },
      }),
      prismaClient.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);

    logger.info(i18next.t("user.mfaDisable.logs.mfaDisabled", { userId }));
    if (isDeployedEnvironment()) {
      logAuthAudit({
        action: AuditAction.MFA_DISABLED,
        userId,
        email: "",
        ipAddress: req.ip,
        success: true,
      });
    }

    // Best-effort security notification — a send failure is logged, never fails the request.
    try {
      await getMailer().send(
        buildMfaDisabledEmail({
          to: decryptKms(user.emailKms),
          name: decryptKms(user.fullNameKms),
        }),
      );
    } catch (emailError) {
      logger.error(
        i18next.t("user.mfaDisable.logs.securityEmailFailed", {
          userId,
          error: String(emailError),
        }),
      );
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.mfaDisable.mfaDisabled"),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.mfaDisable.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.mfaDisable.genericError"),
    );
  }
};

export const verifyMfaLogin = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const genericErrorKey = "user.mfaVerifyLogin.genericError";
  try {
    const prismaClient = await getPrismaClient();
    const { userId, deviceUuid } = req.mfaToken as MfaTokenPayloadModel;
    const { code } = req.body as MfaCodeRequestModel;

    const user = await prismaClient.user.findFirst({
      where: { id: userId, isActive: true },
    });
    if (!user?.mfaEnabledAt || !user.mfaSecretKms) {
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t(genericErrorKey));
      return;
    }

    const codeAccepted = TOTP_CODE_PATTERN.test(code)
      ? await verifyTotpForLogin(prismaClient, user, code)
      : await consumeRecoveryCode(prismaClient, userId, code);

    if (!codeAccepted) {
      await recordFailedMfa(userId);
      logger.warn(
        i18next.t("user.mfaVerifyLogin.logs.invalidCode", { userId }),
      );
      // 422 = "the code is wrong, try again"; distinct from the middleware's 401 = "the
      // 5-minute challenge token expired/invalid, restart from /auth/signin". The client
      // needs to tell those apart, and 401 would otherwise imply a token refresh.
      sendOzariError(
        res,
        HttpEnum.UNPROCESSABLE_ENTITY,
        i18next.t("user.mfaVerifyLogin.invalidCode"),
      );
      return;
    }

    await clearMfaAttempts(userId);

    await issueAuthenticatedSession(prismaClient, res, {
      userId,
      userRole: user.roleId,
      deviceUuid,
    });

    logger.info(
      i18next.t("user.mfaVerifyLogin.logs.userAuthenticated", { userId }),
    );
    if (isDeployedEnvironment()) {
      logAuthAudit({
        action: AuditAction.USER_LOGIN_SUCCESS,
        userId,
        email: "",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceUuid,
        success: true,
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.mfaVerifyLogin.userAuthenticated"),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.mfaVerifyLogin.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.mfaVerifyLogin.genericError"),
    );
  }
};

type PrismaClient = Awaited<ReturnType<typeof getPrismaClient>>;
type UserRecord = NonNullable<
  Awaited<ReturnType<PrismaClient["user"]["findFirst"]>>
>;

async function verifyTotpForLogin(
  prismaClient: PrismaClient,
  user: UserRecord,
  code: string,
): Promise<boolean> {
  if (!user.mfaSecretKms) {
    return false;
  }

  const { valid, step } = verifyTotp(decryptKms(user.mfaSecretKms), code);
  if (!valid) {
    return false;
  }

  // Replay protection: a TOTP step can only be consumed once. The conditional
  // update is atomic, so concurrent requests with the same code cannot both win.
  const lastStep = user.mfaLastUsedAt
    ? getTotpStep(user.mfaLastUsedAt.getTime())
    : -1;
  if (step <= lastStep) {
    return false;
  }

  const stepDate = stepToDate(step);
  const consumed = await prismaClient.user.updateMany({
    where: {
      id: user.id,
      OR: [{ mfaLastUsedAt: null }, { mfaLastUsedAt: { lt: stepDate } }],
    },
    data: { mfaLastUsedAt: stepDate },
  });
  return consumed.count === 1;
}

async function consumeRecoveryCode(
  prismaClient: PrismaClient,
  userId: number,
  code: string,
): Promise<boolean> {
  const codeSha = encryptSha256Sync(normalizeRecoveryCode(code));
  const recoveryCode = await prismaClient.mfaRecoveryCode.findFirst({
    where: { userId, codeSha, usedAt: null },
  });
  if (!recoveryCode) {
    return false;
  }

  await prismaClient.mfaRecoveryCode.update({
    where: { id: recoveryCode.id },
    data: { usedAt: new Date() },
  });
  return true;
}
