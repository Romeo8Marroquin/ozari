import type { NextFunction, Request, Response } from "express";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logSecurityAudit } from "@/config/auditLogger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

// Configuration
const MAX_ATTEMPTS = 5; // Maximum failed attempts
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes

interface LoginAttempt {
  attempts: number;
  resetAt: number; // Timestamp when the limit resets
  firstAttemptAt: number; // Track when the first attempt was made
}

// In-memory store for login attempts (email -> attempt data)
const loginAttempts = new Map<string, LoginAttempt>();

/* c8 ignore start */
// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [email, data] of loginAttempts.entries()) {
    if (now > data.resetAt) {
      loginAttempts.delete(email);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug(
      `Cleaned up ${cleanedCount} expired login rate limit entries`,
    );
  }
}, CLEANUP_INTERVAL_MS);
/* c8 ignore stop */

/**
 * Check if login attempts are within rate limit for an email
 * Call this BEFORE attempting authentication
 */
export function checkLoginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Email should be sanitized by validator before this middleware
  const email = req.body?.email as string | undefined;

  if (!email) {
    // Email validation happens in validator, this shouldn't occur
    logger.warn("checkLoginRateLimit called without email in body");
    next();
    return;
  }

  const now = Date.now();
  const attemptData = loginAttempts.get(email);

  // No previous attempts or window expired
  if (!attemptData || now > attemptData.resetAt) {
    // Start fresh tracking window
    loginAttempts.set(email, {
      attempts: 0, // Will be incremented on failure
      resetAt: now + WINDOW_MS,
      firstAttemptAt: now,
    });
    next();
    return;
  }

  // Check if user has exceeded the limit
  if (attemptData.attempts >= MAX_ATTEMPTS) {
    const remainingMs = attemptData.resetAt - now;
    const remainingMinutes = Math.ceil(remainingMs / 60000);

    logger.warn(
      i18next.t("middlewares.loginRateLimit.logs.tooManyAttempts", {
        email,
        attempts: attemptData.attempts,
        remainingMinutes,
      }),
    );

    sendOzariError(
      res,
      HttpEnum.TOO_MANY_REQUESTS,
      i18next.t("middlewares.loginRateLimit.tooManyAttempts", {
        minutes: remainingMinutes,
      }),
    );
    return;
  }

  // User is within limits, allow to proceed
  next();
}

/**
 * Record a failed login attempt for an email
 * Call this AFTER failed authentication
 */
export function recordFailedLogin(email: string): void {
  const now = Date.now();
  const attemptData = loginAttempts.get(email);

  if (!attemptData || now > attemptData.resetAt) {
    // Start new tracking window
    loginAttempts.set(email, {
      attempts: 1,
      resetAt: now + WINDOW_MS,
      firstAttemptAt: now,
    });
    logger.debug(`Started rate limit tracking for email: ${email}`);
  } else {
    // Increment attempts within existing window
    attemptData.attempts++;
    loginAttempts.set(email, attemptData);

    if (attemptData.attempts >= MAX_ATTEMPTS) {
      const remainingMinutes = Math.ceil((attemptData.resetAt - now) / 60000);
      logger.warn(
        i18next.t("middlewares.loginRateLimit.logs.accountLocked", {
          email,
          attempts: attemptData.attempts,
          remainingMinutes,
        }),
      );

      // Audit log: Account locked due to too many failed attempts
      if (isDeployedEnvironment) {
        logSecurityAudit({
          action: AuditAction.ACCOUNT_LOCKED,
          email,
          success: true,
          reason: `Too many failed login attempts (${attemptData.attempts})`,
          metadata: {
            attempts: attemptData.attempts,
            remainingMinutes,
          },
        });
      }
    } else {
      logger.debug(
        `Failed login attempt ${attemptData.attempts}/${MAX_ATTEMPTS} for email: ${email}`,
      );
    }
  }
}

/**
 * Clear login attempts for an email after successful login
 * Call this AFTER successful authentication
 */
export function clearLoginAttempts(email: string): void {
  const hadAttempts = loginAttempts.has(email);
  loginAttempts.delete(email);

  if (hadAttempts) {
    logger.debug(`Cleared login rate limit tracking for email: ${email}`);
  }
}

/**
 * Get current attempt count for an email (useful for debugging/monitoring)
 */
export function getAttemptCount(email: string): number {
  const attemptData = loginAttempts.get(email);
  if (!attemptData || Date.now() > attemptData.resetAt) {
    return 0;
  }
  return attemptData.attempts;
}
