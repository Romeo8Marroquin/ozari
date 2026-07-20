import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createClientRegistry,
  getClientRegistries,
} from "./clientRegistries.controller.js";
import { validateCreateClientRegistry } from "./clientRegistries.validator.js";

const router: RouterType = Router();

// **STRICTLY Admin**, reads and writes alike: the registry is the admin's tool for walk-in
// (WhatsApp/phone) clients — it holds third parties' PII that no other role has any business
// reading. Same widening rule as order creation: a future call-center role gets access only via a
// deliberate, owner-approved change here.
const adminOnly = isGrantedRoles([RolesEnum.Admin]);
router.get("/", verifyJwt, adminOnly, getClientRegistries);
router.post("/", verifyJwt, adminOnly, validateCreateClientRegistry, createClientRegistry);

export default router;
