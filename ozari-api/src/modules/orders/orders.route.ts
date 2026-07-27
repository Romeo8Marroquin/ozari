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
import {
  advanceOrder,
  createOrderEvidenceUploads,
} from "./advance/advance.controller.js";
import {
  validateAdvanceOrder,
  validateOrderEvidenceUploads,
} from "./advance/advance.validator.js";

const router: RouterType = Router();

// Region: Role-protected reads. The LIST is now Admin + Driver — `getOrders` row-scopes per role
// (Driver → only orders assigned to them; Admin → all, each tagged MINE vs the rest), so the guard
// widened TOGETHER with that scoping, as the rule demands. `/catalog` (create-form reference data)
// and `/:id` (the full detail, its own driver slice is a later story) stay Admin-only for now.
// `/catalog` is declared before `/:id` so it never matches as a param.
const canListOrders = isGrantedRoles([RolesEnum.Admin, RolesEnum.Driver]);
const canReadOrders = isGrantedRoles([RolesEnum.Admin]);
router.get("/", verifyJwt, canListOrders, getOrders);
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

// Region: The LIFECYCLE mutations — **Admin + Driver**, one door for every move (advance, admin
// rewind, cancel). The guard is deliberately wide and the ENGINE narrows it per order: a driver may
// only touch orders assigned to them, and only forward or cancel (owner decision 2026-07-27), which
// `transitionKindFor` enforces again under the row lock. `/evidence/upload-url` is declared before
// `/:id/advance` so a literal path segment can never be read as an id.
const canAdvanceOrders = isGrantedRoles([RolesEnum.Admin, RolesEnum.Driver]);
router.post(
  "/evidence/upload-url",
  verifyJwt,
  canAdvanceOrders,
  validateOrderEvidenceUploads,
  createOrderEvidenceUploads,
);
router.post(
  "/:id/advance",
  verifyJwt,
  canAdvanceOrders,
  validateAdvanceOrder,
  advanceOrder,
);

export default router;
