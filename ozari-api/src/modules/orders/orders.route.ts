import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createOrder,
  getOrderAvailability,
  getOrderById,
  getOrders,
  getOrdersCatalog,
} from "./orders.controller.js";
import { validateCreateOrder, validateOrderAvailability } from "./orders.validator.js";

const router: RouterType = Router();

// Region: Role-protected reads — **Admin only** for now (fail-closed): the Client "mis pedidos"
// and Driver "mis entregas" slices arrive with their own row scoping (own orders / assigned
// orders) and role projection — widen the guard ONLY together with that scoping, never before.
// `/catalog` is declared before `/:id` so it never matches as a param.
const canReadOrders = isGrantedRoles([RolesEnum.Admin]);
router.get("/", verifyJwt, canReadOrders, getOrders);
router.get("/catalog", verifyJwt, canReadOrders, getOrdersCatalog);
router.get("/:id", verifyJwt, canReadOrders, getOrderById);

// Region: Order creation — **STRICTLY Admin** (owner rule: ONLY the admin creates orders; no
// employee — not even a future call-center role — inherits this by default. If a call-center
// employee type ever gets walk-in creation, THIS guard widens deliberately, in its own commit,
// with the owner's sign-off — never as a side effect of adding the role.) The cheap DB-free role
// check runs BEFORE the validator (which hits the DB) — a non-admin is denied without a query.
router.post(
  "/",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateCreateOrder,
  createOrder,
);

// Region: Live availability probe — **Admin only** (exact counts; a Client tier would cap instead,
// see EPIC-2 §11.A). Read-only + advisory: the create path re-checks under the product lock.
router.post(
  "/availability",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateOrderAvailability,
  getOrderAvailability,
);

export default router;
