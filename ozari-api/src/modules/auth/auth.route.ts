import { Router, type Router as RouterType } from "express";
import rateLimit from "express-rate-limit";
import {
  verifyJwt,
  verifyMfaChallengeToken,
} from "@middlewares/auth.middleware.js";
import { checkLoginRateLimit } from "@middlewares/loginRateLimit.middleware.js";
import { checkMfaRateLimit } from "@middlewares/mfaRateLimit.middleware.js";
import { verifyCsrfToken } from "@middlewares/csrf.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  changePassword,
  createUser,
  getAllUsers,
  getMe,
  refreshToken,
  signInUser,
  signOutUser,
} from "./auth.controller.js";
import {
  disableMfa,
  enableMfa,
  setupMfa,
  verifyMfaLogin,
} from "./auth.mfa.controller.js";
import {
  forgotPassword,
  resetPassword,
} from "./auth.password.controller.js";
import {
  validateChangePassword,
  validateCreateUser,
  validateForgotPassword,
  validateMfaCode,
  validateMfaDisable,
  validateResetPassword,
  validateSignIn,
} from "./auth.validator.js";

const router: RouterType = Router();

// Auth responses carry session/account data (the /me profile is decrypted PII) — forbid the
// browser's HTTP cache from persisting ANY of it to disk. This also means no ETag/304 revalidation
// on these endpoints: every response is fresh and nothing sensitive outlives the tab.
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/**
 * Strict limiter for CREDENTIAL endpoints only — the ones that verify a brute-forceable secret
 * (password, TOTP code) or create accounts. Applied PER-ROUTE and stacked on top of the router's
 * authenticated tier (see app.ts): session reads like `GET /me` (hit on every panel mount/focus)
 * and idempotent signout deliberately do NOT share this budget — a user navigating the panel must
 * never be able to starve their own login, and 10 profile reads/min would do exactly that.
 */
const credentialLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10, // 10 requests per minute per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many authentication requests, please try again later.",
});

// Refresh token rate limiter (prevent token refresh spam)
const refreshTokenLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 5, // 5 refresh attempts per minute (stricter than normal auth)
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many token refresh requests, please try again later.",
});

// Role Protected Routes
router.get("/all", verifyJwt, isGrantedRoles([RolesEnum.Admin]), getAllUsers);

// Protected Routes
router.get("/me", verifyJwt, getMe);
router.post("/signout", verifyCsrfToken, signOutUser);
router.post(
  "/change-password",
  credentialLimiter, // verifies the CURRENT password — a brute-forceable secret
  verifyJwt,
  verifyCsrfToken,
  validateChangePassword,
  changePassword,
);

// MFA management (authenticated)
router.post("/mfa/setup", verifyJwt, verifyCsrfToken, setupMfa);
router.post(
  "/mfa/enable",
  credentialLimiter, // verifies a TOTP code
  verifyJwt,
  verifyCsrfToken,
  validateMfaCode,
  enableMfa,
);
router.post(
  "/mfa/disable",
  credentialLimiter, // verifies the account password
  verifyJwt,
  verifyCsrfToken,
  validateMfaDisable,
  disableMfa,
);

// Password reset rate limiter (per instance) — throttles both the request (email bombing /
// enumeration timing) and the token-submit endpoints.
const passwordResetLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many password reset requests, please try again later.",
});

// Public Routes
router.post("/user", credentialLimiter, validateCreateUser, createUser);
router.post(
  "/signin",
  credentialLimiter,
  validateSignIn,
  checkLoginRateLimit,
  signInUser,
);
router.post("/refresh", refreshTokenLimiter, verifyCsrfToken, refreshToken);
router.post(
  "/forgot-password",
  passwordResetLimiter,
  validateForgotPassword,
  forgotPassword,
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validateResetPassword,
  resetPassword,
);

// MFA login challenge (second step of login; authenticated by the MFA token)
router.post(
  "/mfa/verify-login",
  credentialLimiter, // verifies a TOTP / recovery code
  verifyMfaChallengeToken,
  checkMfaRateLimit,
  validateMfaCode,
  verifyMfaLogin,
);

export default router;
