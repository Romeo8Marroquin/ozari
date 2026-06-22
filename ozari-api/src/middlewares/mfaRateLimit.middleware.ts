import type { NextFunction, Response } from "express";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logSecurityAudit } from "@/config/auditLogger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface MfaAttempt {
  attempts: number;
  resetAt: number;
}

// In-memory store keyed by userId. Like the login limiter, this is per-instance;
// move to a shared store (Redis/Memorystore) for global enforcement at scale.
const mfaAttempts = new Map<number, MfaAttempt>();

/* c8 ignore start */
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of mfaAttempts.entries()) {
    if (now > data.resetAt) {
      mfaAttempts.delete(userId);
    }
  }
}, CLEANUP_INTERVAL_MS);
/* c8 ignore stop */

/**
 * Block MFA verification once a user exceeds the failed-attempt threshold,
 * preventing TOTP brute force even with a valid password and rotating IPs.
 * Runs after the MFA challenge token is verified, so the userId is trusted.
 */
export function checkMfaRateLimit(
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.mfaToken?.userId;
  if (userId === undefined) {
    next();
    return;
  }

  const now = Date.now();
  const attemptData = mfaAttempts.get(userId);

  if (attemptData && now <= attemptData.resetAt && attemptData.attempts >= MAX_ATTEMPTS) {
    const remainingMinutes = Math.ceil((attemptData.resetAt - now) / 60000);
    logger.warn(
      i18next.t("middlewares.mfaRateLimit.logs.tooManyAttempts", {
        userId,
        attempts: attemptData.attempts,
        remainingMinutes,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.TOO_MANY_REQUESTS,
      i18next.t("middlewares.mfaRateLimit.tooManyAttempts", {
        minutes: remainingMinutes,
      }),
    );
    return;
  }

  next();
}

export function recordFailedMfa(userId: number): void {
  const now = Date.now();
  const attemptData = mfaAttempts.get(userId);

  if (!attemptData || now > attemptData.resetAt) {
    mfaAttempts.set(userId, { attempts: 1, resetAt: now + WINDOW_MS });
    return;
  }

  attemptData.attempts++;
  mfaAttempts.set(userId, attemptData);

  if (attemptData.attempts >= MAX_ATTEMPTS) {
    const remainingMinutes = Math.ceil((attemptData.resetAt - now) / 60000);
    logger.warn(
      i18next.t("middlewares.mfaRateLimit.logs.accountLocked", {
        userId,
        attempts: attemptData.attempts,
        remainingMinutes,
      }),
    );
    if (isDeployedEnvironment()) {
      logSecurityAudit({
        action: AuditAction.ACCOUNT_LOCKED,
        userId,
        success: true,
        reason: `Too many failed MFA attempts (${attemptData.attempts})`,
        metadata: { remainingMinutes },
      });
    }
  }
}

export function clearMfaAttempts(userId: number): void {
  mfaAttempts.delete(userId);
}

export function getMfaAttemptCount(userId: number): number {
  const attemptData = mfaAttempts.get(userId);
  if (!attemptData || Date.now() > attemptData.resetAt) {
    return 0;
  }
  return attemptData.attempts;
}
