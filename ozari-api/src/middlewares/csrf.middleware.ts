import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";

/**
 * CSRF Protection Middleware — stateless, signed-token, header-based.
 *
 * Why NOT the classic double-submit COOKIE pattern:
 * - That pattern needs the SPA to read the token via `document.cookie` and echo it in a
 *   header. `document.cookie` is same-origin only, and in deployed environments the FE
 *   (Cloudflare Pages) and API (Cloud Run) are on different registrable domains, so the
 *   FE can never read a cookie the API set on its own domain. A readable CSRF cookie is
 *   therefore impossible cross-domain.
 *
 * What we do instead (works on local, staging and prod identically):
 * 1. On login / refresh the API issues a token in the `x-csrf-token` RESPONSE header.
 * 2. The SPA stores it (like the access token) and echoes it in the `x-csrf-token`
 *    REQUEST header on every state-changing call.
 * 3. The token is a stateless HMAC: `"<nonce>.<hmac>"`, signed with a key derived from
 *    JWT_SECRET. Verification just re-computes the HMAC — no server state, no cookie.
 *
 * Why this is secure (defense in depth):
 * - A cross-site attacker cannot OBTAIN a valid token: the issuing response is readable
 *   only by the allow-listed origin (strict CORS), and the HMAC can't be forged.
 * - A cross-site attacker cannot SEND the `x-csrf-token` header: a custom header forces a
 *   CORS preflight, which the strict origin allowlist rejects. (This alone blocks the
 *   simple-request CSRF vector; the signed value is the second layer.)
 * - The token is NOT a session credential — it grants nothing on its own.
 */

const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_NONCE_BYTES = 32; // 256-bit random nonce
const CSRF_KEY_LABEL = "ozari-csrf-token-signing-v1";

/**
 * Derive a dedicated CSRF signing subkey from JWT_SECRET. Domain separation (the fixed
 * label) means the CSRF MAC never shares raw key material with JWT signing, so the two
 * uses can't be played off against each other.
 */
function getCsrfSigningKey(): Buffer {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not defined");
  }
  return crypto.createHmac("sha256", secret).update(CSRF_KEY_LABEL).digest();
}

function signNonce(nonce: string): string {
  return crypto
    .createHmac("sha256", getCsrfSigningKey())
    .update(nonce)
    .digest("hex");
}

/**
 * Generate a new stateless CSRF token: "<nonce>.<hmac>".
 */
export function generateCsrfToken(): string {
  const nonce = crypto.randomBytes(CSRF_NONCE_BYTES).toString("hex");
  return `${nonce}.${signNonce(nonce)}`;
}

/**
 * Issue a fresh CSRF token to the client via the `x-csrf-token` response header.
 * Call this on login and token refresh. (For the FE to read this cross-origin header,
 * it must be listed in the CORS `exposedHeaders` — see `app.ts`.)
 */
export function setCsrfToken(res: Response): string {
  const token = generateCsrfToken();
  res.header(CSRF_HEADER_NAME, token);
  return token;
}

/**
 * Verify the CSRF token on state-changing operations.
 *
 * Safe methods (GET, HEAD, OPTIONS) are exempt. All others require a valid signed token
 * in the `x-csrf-token` request header.
 */
export function verifyCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const method = req.method.toUpperCase();

  // Safe methods don't change state and don't need CSRF protection.
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  if (!headerToken) {
    logger.warn(i18next.t("middlewares.csrf.logs.tokenMissing"));
    sendOzariError(
      res,
      HttpEnum.FORBIDDEN,
      i18next.t("middlewares.csrf.tokenMissing"),
    );
    return;
  }

  const separatorIndex = headerToken.lastIndexOf(".");
  const nonce =
    separatorIndex > 0 ? headerToken.slice(0, separatorIndex) : "";
  const signature =
    separatorIndex > 0 ? headerToken.slice(separatorIndex + 1) : "";

  if (!nonce || !signature || !timingSafeEqual(signature, signNonce(nonce))) {
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

  logger.debug(
    i18next.t("middlewares.csrf.logs.tokenValid", {
      method: req.method,
      url: req.originalUrl,
    }),
  );
  next();
}

/**
 * Timing-safe string comparison. Prevents leaking how much of the signature matched.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
