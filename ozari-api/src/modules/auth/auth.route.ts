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
  validateChangePassword,
  validateCreateUser,
  validateMfaCode,
  validateMfaDisable,
  validateSignIn,
} from "./auth.validator.js";

const router: RouterType = Router();

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
  verifyJwt,
  verifyCsrfToken,
  validateChangePassword,
  changePassword,
);

// MFA management (authenticated)
router.post("/mfa/setup", verifyJwt, verifyCsrfToken, setupMfa);
router.post(
  "/mfa/enable",
  verifyJwt,
  verifyCsrfToken,
  validateMfaCode,
  enableMfa,
);
router.post(
  "/mfa/disable",
  verifyJwt,
  verifyCsrfToken,
  validateMfaDisable,
  disableMfa,
);

// Public Routes
router.post("/user", validateCreateUser, createUser);
router.post("/signin", validateSignIn, checkLoginRateLimit, signInUser);
router.post("/refresh", refreshTokenLimiter, verifyCsrfToken, refreshToken);

// MFA login challenge (second step of login; authenticated by the MFA token)
router.post(
  "/mfa/verify-login",
  verifyMfaChallengeToken,
  checkMfaRateLimit,
  validateMfaCode,
  verifyMfaLogin,
);

export default router;
