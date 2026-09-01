import type { NextFunction, Response } from "express";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logSecurityAudit } from "@/config/auditLogger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  AuthAttemptScope,
  attemptState,
  clearAttempts,
  recordFailedAttempt,
} from "@services/authThrottle.service.js";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** The subject is the user id — this limiter runs AFTER the MFA challenge token is verified, so the
 *  id is trusted, and unlike an email it is not information worth hiding. */
const subjectOf = (userId: number): string => String(userId);

/**
 * Block MFA verification once a user exceeds the failed-attempt threshold,
 * preventing TOTP brute force even with a valid password and rotating IPs.
 * Runs after the MFA challenge token is verified, so the userId is trusted.
 *
 * Counts live in the DATABASE alongside the login limiter's (`authThrottle.service`) — one store for
 * every guessable secret, global across instances and durable across cold starts. Thresholds,
 * window, status and messages are unchanged by that move.
 */
export async function checkMfaRateLimit(
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.mfaToken?.userId;
  if (userId === undefined) {
    next();
    return;
  }

  const state = await attemptState(AuthAttemptScope.MFA, subjectOf(userId));
  if (state && state.attempts >= MAX_ATTEMPTS) {
    logger.warn(
      i18next.t("middlewares.mfaRateLimit.logs.tooManyAttempts", {
        userId,
        attempts: state.attempts,
        remainingMinutes: state.remainingMinutes,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.TOO_MANY_REQUESTS,
      i18next.t("middlewares.mfaRateLimit.tooManyAttempts", {
        minutes: state.remainingMinutes,
      }),
    );
    return;
  }

  next();
}

export async function recordFailedMfa(userId: number): Promise<void> {
  const state = await recordFailedAttempt(
    AuthAttemptScope.MFA,
    subjectOf(userId),
    WINDOW_MS,
  );
  if (!state || state.attempts < MAX_ATTEMPTS) {
    return;
  }

  logger.warn(
    i18next.t("middlewares.mfaRateLimit.logs.accountLocked", {
      userId,
      attempts: state.attempts,
      remainingMinutes: state.remainingMinutes,
    }),
  );
  if (isDeployedEnvironment()) {
    logSecurityAudit({
      action: AuditAction.ACCOUNT_LOCKED,
      userId,
      success: true,
      reason: `Too many failed MFA attempts (${state.attempts})`,
      metadata: { remainingMinutes: state.remainingMinutes },
    });
  }
}

export async function clearMfaAttempts(userId: number): Promise<void> {
  await clearAttempts(AuthAttemptScope.MFA, subjectOf(userId));
}

export async function getMfaAttemptCount(userId: number): Promise<number> {
  const state = await attemptState(AuthAttemptScope.MFA, subjectOf(userId));
  return state?.attempts ?? 0;
}
