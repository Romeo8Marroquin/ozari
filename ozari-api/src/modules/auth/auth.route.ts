import { Router, type Router as RouterType } from "express";
import rateLimit from "express-rate-limit";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { checkLoginRateLimit } from "@middlewares/loginRateLimit.middleware.js";
import { verifyCsrfToken } from "@middlewares/csrf.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createUser,
  getAllUsers,
  refreshToken,
  signInUser,
  signOutUser,
} from "./auth.controller.js";
import { validateCreateUser, validateSignIn } from "./auth.validator.js";

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
router.post("/signout", verifyJwt, verifyCsrfToken, signOutUser);

// Public Routes
router.post("/user", validateCreateUser, createUser);
router.post("/signin", validateSignIn, checkLoginRateLimit, signInUser);
router.post("/refresh", refreshTokenLimiter, verifyCsrfToken, refreshToken);

export default router;
