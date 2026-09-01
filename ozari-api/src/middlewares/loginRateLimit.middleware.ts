import type { NextFunction, Request, Response } from "express";
import { isDeployedEnvironment } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logSecurityAudit } from "@/config/auditLogger.js";
import { encryptSha256Sync } from "@helpers/encryption.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  AuthAttemptScope,
  attemptState,
  clearAttempts,
  recordFailedAttempt,
} from "@services/authThrottle.service.js";

// Configuration — unchanged: five failures buy a fifteen-minute pause for that ACCOUNT.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * The per-ACCOUNT brute-force guard on `/auth/signin`, keyed by the email rather than the IP: an
 * attacker rotating addresses still runs into it, and one office behind a single NAT does not.
 *
 * The counters live in the DATABASE (`authThrottle.service`), not in this process — see that module
 * for why. Nothing about the POLICY changed with the move: same five attempts, same fifteen minutes,
 * same `429`, same message, same `ACCOUNT_LOCKED` audit event.
 *
 * ⚠️ **The stored subject is the email's SHA-256, never the address.** A table of plaintext emails
 * that reveals which ones have accounts is exactly what the login endpoint's constant-time path
 * exists to avoid leaking; hashing keeps the counter useful and the table meaningless if read.
 */
const subjectOf = (email: string): string => encryptSha256Sync(email);

/**
 * Refuse a login for an account that has already burned its attempts.
 * Call BEFORE authenticating.
 */
export async function checkLoginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Email should be sanitized by validator before this middleware
  const email = req.body?.email as string | undefined;

  if (!email) {
    // Email validation happens in validator, this shouldn't occur
    logger.warn("checkLoginRateLimit called without email in body");
    next();
    return;
  }

  const state = await attemptState(AuthAttemptScope.LOGIN, subjectOf(email));
  if (state && state.attempts >= MAX_ATTEMPTS) {
    logger.warn(
      i18next.t("middlewares.loginRateLimit.logs.tooManyAttempts", {
        email,
        attempts: state.attempts,
        remainingMinutes: state.remainingMinutes,
      }),
    );

    sendOzariError(
      res,
      HttpEnum.TOO_MANY_REQUESTS,
      i18next.t("middlewares.loginRateLimit.tooManyAttempts", {
        minutes: state.remainingMinutes,
      }),
    );
    return;
  }

  // Within limits (or the counter could not be read — it fails open, see the service).
  next();
}

/**
 * Record a failed login attempt for an email.
 * Call this AFTER failed authentication.
 */
export async function recordFailedLogin(email: string): Promise<void> {
  const state = await recordFailedAttempt(
    AuthAttemptScope.LOGIN,
    subjectOf(email),
    WINDOW_MS,
  );
  if (!state) {
    return;
  }

  if (state.attempts >= MAX_ATTEMPTS) {
    logger.warn(
      i18next.t("middlewares.loginRateLimit.logs.accountLocked", {
        email,
        attempts: state.attempts,
        remainingMinutes: state.remainingMinutes,
      }),
    );

    // Audit log: Account locked due to too many failed attempts
    if (isDeployedEnvironment()) {
      logSecurityAudit({
        action: AuditAction.ACCOUNT_LOCKED,
        email,
        success: true,
        reason: `Too many failed login attempts (${state.attempts})`,
        metadata: {
          attempts: state.attempts,
          remainingMinutes: state.remainingMinutes,
        },
      });
    }
    return;
  }

  logger.debug(
    `Failed login attempt ${state.attempts}/${MAX_ATTEMPTS} for email: ${email}`,
  );
}

/**
 * Clear login attempts for an email after successful login — an honest user who mistyped four times
 * starts clean instead of carrying a near-lockout into their next session.
 */
export async function clearLoginAttempts(email: string): Promise<void> {
  await clearAttempts(AuthAttemptScope.LOGIN, subjectOf(email));
}

/** Current attempt count for an email (monitoring/debugging; `0` when there is no live window). */
export async function getAttemptCount(email: string): Promise<number> {
  const state = await attemptState(AuthAttemptScope.LOGIN, subjectOf(email));
  return state?.attempts ?? 0;
}
