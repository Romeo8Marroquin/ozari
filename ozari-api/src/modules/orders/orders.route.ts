import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  getOrderById,
  getOrders,
  getOrdersCatalog,
} from "./orders.controller.js";

const router: RouterType = Router();

// Region: Role-protected reads — **Admin only** for now (fail-closed): the Client "mis pedidos"
// and Driver "mis entregas" slices arrive with their own row scoping (own orders / assigned
// orders) and role projection — widen the guard ONLY together with that scoping, never before.
// `/catalog` is declared before `/:id` so it never matches as a param.
const canReadOrders = isGrantedRoles([RolesEnum.Admin]);
router.get("/", verifyJwt, canReadOrders, getOrders);
router.get("/catalog", verifyJwt, canReadOrders, getOrdersCatalog);
router.get("/:id", verifyJwt, canReadOrders, getOrderById);

export default router;
