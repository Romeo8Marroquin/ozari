import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { appConfig } from "@/config/app.js";

/**
 * CSRF Protection Middleware
 *
 * Implements Double Submit Cookie pattern:
 * 1. CSRF token is generated and sent in a cookie (readable by JS)
 * 2. Client must send the same token in X-CSRF-Token header
 * 3. Middleware verifies cookie token matches header token
 *
 * Why this works:
 * - Attacker can't read cookies from victim's browser (Same-Origin Policy)
 * - Attacker can't set custom headers in simple requests (CORS preflight)
 * - Even if attacker tricks victim into making request, they can't know the token
 *
 * Security Note:
 * - CSRF token is NOT httpOnly (must be readable by frontend JS)
 * - Token is cryptographically random (128 bits)
 * - Token is tied to user session via cookie
 * - SameSite='lax' provides additional protection
 */

const CSRF_TOKEN_LENGTH = 32; // 32 bytes = 256 bits
const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * Generate a new CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/**
 * Set CSRF token in response cookie
 * Call this on login and token refresh
 */
export function setCsrfToken(res: Response): string {
  const token = generateCsrfToken();

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: appConfig.cookieConfig.secure,
    sameSite: appConfig.cookieConfig.sameSite,
    maxAge: appConfig.cookieConfig.maxAge,
    path: "/api", // Available to all API routes
  });

  return token;
}

/**
 * Clear CSRF token on logout
 */
export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    path: "/api",
  });
}

/**
 * Verify CSRF token for state-changing operations
 *
 * Safe methods (GET, HEAD, OPTIONS) are exempt from CSRF checks
 * All other methods (POST, PUT, DELETE, PATCH) require valid CSRF token
 *
 * Usage: Add to protected routes that modify state
 * Example: router.post('/create', verifyJwt, verifyCsrfToken, createHandler)
 */
export function verifyCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const method = req.method.toUpperCase();

  // Safe methods don't need CSRF protection
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Get token from cookie and header
  const cookieToken = req.cookies[CSRF_COOKIE_NAME] as string | undefined;
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  // Both must be present
  if (!cookieToken || !headerToken) {
    logger.warn(
      i18next.t("middlewares.csrf.logs.tokenMissing", {
        hasCookie: !!cookieToken,
        hasHeader: !!headerToken,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.FORBIDDEN,
      i18next.t("middlewares.csrf.tokenMissing"),
    );
    return;
  }

  // Tokens must match (timing-safe comparison)
  if (!timingSafeEqual(cookieToken, headerToken)) {
    logger.warn(
      i18next.t("middlewares.csrf.logs.tokenMismatch", {
        method: req.method,
        url: req.originalUrl,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.FORBIDDEN,
      i18next.t("middlewares.csrf.tokenInvalid"),
    );
    return;
  }

  // CSRF token is valid
  logger.debug(
    i18next.t("middlewares.csrf.logs.tokenValid", {
      method: req.method,
      url: req.originalUrl,
    }),
  );
  next();
}

/**
 * Timing-safe string comparison
 * Prevents timing attacks by ensuring comparison takes constant time
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return crypto.timingSafeEqual(bufA, bufB);
}
