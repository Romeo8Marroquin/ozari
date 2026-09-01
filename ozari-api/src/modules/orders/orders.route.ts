import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createOrder,
  deleteOrder,
  getOrderAvailability,
  getOrderById,
  getOrders,
  getOrdersCatalog,
  updateOrder,
} from "./orders.controller.js";
import {
  validateCreateOrder,
  validateOrderAvailability,
  validateUpdateOrder,
} from "./orders.validator.js";
import {
  advanceOrder,
  createOrderEvidenceUploads,
} from "./advance/advance.controller.js";
import {
  validateAdvanceOrder,
  validateOrderEvidenceUploads,
} from "./advance/advance.validator.js";
import { payOrder, undoOrderPayment } from "./payment/payment.controller.js";
import {
  validatePayOrder,
  validateUndoOrderPayment,
} from "./payment/payment.validator.js";

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
// The DETAIL is Admin + Driver, row-scoped in the controller: a driver's query is narrowed to
// `assignedUserId = self`, so another worker's order answers the same plain 404 as a missing one —
// the guard widened TOGETHER with that scoping, as the rule demands.
router.get("/:id", verifyJwt, canListOrders, getOrderById);

// Region: **Permanent deletion — STRICTLY Admin.** Destroys the order and everything that exists
// only because of it (evidence + objects, status trail, lines, extras) and returns sale stock. A
// driver never deletes; cancelling is their off-ramp.
router.delete("/:id", verifyJwt, isGrantedRoles([RolesEnum.Admin]), deleteOrder);

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

// Region: The full order EDIT — **STRICTLY Admin**, same stance as creation (a driver reports what
// happened through the lifecycle; rewriting what was agreed is the admin's job). Declarative: the
// body is the order's FINAL state and is validated by the very same contract as create, so the two
// can never drift apart.
router.put(
  "/:id",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateUpdateOrder,
  updateOrder,
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

// Region: Recording PAYMENT — **STRICTLY Admin**, and deliberately its own door rather than a step
// of the lifecycle: payment and fulfilment are independent axes (a client may pay days before
// delivery, at the door, or a week after collection), so folding it into the pipeline would impose
// an ordering the business does not have. A driver reports what happened physically; money is the
// admin's.
router.post(
  "/:id/payment",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validatePayOrder,
  payOrder,
);
// DELETING that record — the inverse write, and a hard delete: nothing is kept, so there is no undo
// of the undo. Same guard, because recording money is the admin's and so is unrecording it. It is
// NOT a refund (money travelling back to the client is a different event with its own amount, date
// and method); this only touches our own books.
router.delete(
  "/:id/payment",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateUndoOrderPayment,
  undoOrderPayment,
);

export default router;
