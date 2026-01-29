import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
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

// Role Protected Routes
router.get("/all", verifyJwt, isGrantedRoles([RolesEnum.Admin]), getAllUsers);

// Protected Routes
router.get("/signout", verifyJwt, signOutUser);

// Public Routes
router.post("/user", validateCreateUser, createUser);
router.post("/signin", validateSignIn, signInUser);
router.get("/refresh", refreshToken);

export default router;
