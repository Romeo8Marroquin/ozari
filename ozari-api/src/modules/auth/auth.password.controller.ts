import crypto from "node:crypto";
import type { Request, Response } from "express";
import { appConfig } from "@/config/app.js";
import { AuditAction, logSecurityAudit } from "@/config/auditLogger.js";
import { getAppHost, isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import {
  comparePassword,
  decryptKms,
  encryptSha256Sync,
  hashPassword,
} from "@helpers/encryption.js";
import { getMailer } from "@helpers/mailer.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import {
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
} from "../../emails/securityEmail.js";
import type {
  ForgotPasswordRequestModel,
  ResetPasswordRequestModel,
} from "./auth.models.js";

// The reset link points at the frontend route that reads `?token=` and shows the new-password form.
const FALLBACK_URL = "https://www.partyrentalsgt.com";
const RESET_PATH = "/sesion/restablecer";

/**
 * Step 1 — request a reset. ALWAYS returns the same generic success, whether or not the email maps to
 * an account, so it can't be used to enumerate registered emails (same discipline as login). When the
 * email IS known, mint a single-use, short-lived token (only its SHA-256 hash is stored), invalidate
 * any outstanding tokens, and email the tokenized reset link. The email send is best-effort.
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email } = req.body as ForgotPasswordRequestModel;
    const prismaClient = await getPrismaClient();

    // `email` is already trimmed + lowercased by the validator, so the hash matches the stored one.
    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findFirst({
      where: { emailSha, isActive: true },
    });

    if (user) {
      // Persistent per-account cooldown: if a reset email was sent to this account very recently,
      // don't send another (anti-bombing). The existing valid link still stands. Backed by the live
      // token's createdAt, so it holds across instances — unlike the per-IP in-memory rate limiter.
      const existing = await prismaClient.passwordResetToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      const cooldownMs = appConfig.passwordReset.resendCooldownSeconds * 1000;
      const withinCooldown =
        existing !== null && Date.now() - existing.createdAt.getTime() < cooldownMs;

      if (withinCooldown) {
        logger.info(
          i18next.t("user.forgotPassword.logs.resendThrottled", {
            userId: user.id,
          }),
        );
      } else {
        const rawToken = crypto
          .randomBytes(appConfig.passwordReset.tokenBytes)
          .toString("base64url");
        const tokenSha = encryptSha256Sync(rawToken);
        const expiresAt = new Date(
          Date.now() + appConfig.passwordReset.tokenTtlMinutes * 60_000,
        );

        // One live token per user: drop any outstanding ones, then create the fresh token.
        await prismaClient.$transaction([
          prismaClient.passwordResetToken.deleteMany({
            where: { userId: user.id },
          }),
          prismaClient.passwordResetToken.create({
            data: { userId: user.id, tokenSha, expiresAt },
          }),
        ]);

        const resetUrl = `${getAppHost() || FALLBACK_URL}${RESET_PATH}?token=${rawToken}`;
        try {
          await getMailer().send(
            buildPasswordResetEmail({
              to: decryptKms(user.emailKms),
              name: decryptKms(user.fullNameKms),
              resetUrl,
            }),
          );
        } catch (emailError) {
          logger.error(
            i18next.t("user.forgotPassword.logs.emailFailed", {
              userId: user.id,
              error: String(emailError),
            }),
          );
        }

        logger.info(
          i18next.t("user.forgotPassword.logs.resetRequested", {
            userId: user.id,
          }),
        );
      }
    } else {
      logger.info(i18next.t("user.forgotPassword.logs.unknownEmail"));
    }

    // Generic response regardless of whether the email exists — no account enumeration.
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.forgotPassword.genericSuccess"),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.forgotPassword.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.forgotPassword.genericError"),
    );
  }
};

/**
 * Step 2 — reset with the token. Invalid/used/expired tokens all return the SAME generic `400` (no
 * leaking which case). On success: reject reusing the current password, set the new one, consume the
 * token, and REVOKE ALL sessions on every device (unlike change-password, there is no trusted current
 * device here — the user forgot the password). A best-effort "password changed" email confirms it.
 */
export const resetPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { token, newPassword } = req.body as ResetPasswordRequestModel;
    const prismaClient = await getPrismaClient();

    const tokenSha = encryptSha256Sync(token);
    const resetToken = await prismaClient.passwordResetToken.findUnique({
      where: { tokenSha },
    });

    // Invalid (unknown) or expired tokens collapse to the same generic error. There is no "used"
    // state: a consumed token is deleted (below), so a replay simply finds nothing.
    if (!resetToken || resetToken.expiresAt.getTime() < Date.now()) {
      logger.warn(i18next.t("user.resetPassword.logs.invalidToken"));
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.resetPassword.invalidToken"),
      );
      return;
    }

    const user = await prismaClient.user.findFirst({
      where: { id: resetToken.userId, isActive: true },
    });
    if (!user) {
      logger.warn(i18next.t("user.resetPassword.logs.invalidToken"));
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.resetPassword.invalidToken"),
      );
      return;
    }

    const reusedPassword = await comparePassword(newPassword, user.passwordSha);
    if (reusedPassword) {
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("user.resetPassword.passwordReused"),
      );
      return;
    }

    const passwordSha = await hashPassword(newPassword);

    // Set the new password, consume every reset token for the user, and revoke ALL sessions.
    await prismaClient.$transaction([
      prismaClient.user.update({
        where: { id: user.id },
        data: { passwordSha },
      }),
      prismaClient.passwordResetToken.deleteMany({
        where: { userId: user.id },
      }),
      prismaClient.jwtSession.deleteMany({ where: { userId: user.id } }),
    ]);

    logger.info(
      i18next.t("user.resetPassword.logs.passwordReset", { userId: user.id }),
    );
    if (isDeployedEnvironment()) {
      logSecurityAudit({
        action: AuditAction.PASSWORD_CHANGED,
        userId: user.id,
        ipAddress: req.ip,
        success: true,
      });
    }

    // Best-effort confirmation (reuse the password-changed notice).
    try {
      await getMailer().send(
        buildPasswordChangedEmail({
          to: decryptKms(user.emailKms),
          name: decryptKms(user.fullNameKms),
        }),
      );
    } catch (emailError) {
      logger.error(
        i18next.t("user.resetPassword.logs.emailFailed", {
          userId: user.id,
          error: String(emailError),
        }),
      );
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("user.resetPassword.passwordReset"),
    );
  } catch (error) {
    logger.error(
      i18next.t("user.resetPassword.logs.internalServerError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("user.resetPassword.genericError"),
    );
  }
};
