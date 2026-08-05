import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { getDashboard } from "./dashboard.controller.js";

const router: RouterType = Router();

// Region: The admin home screen — **STRICTLY Admin**. It aggregates the whole business (revenue,
// every client's next delivery, what is owed), so unlike `/orders` this guard does NOT widen by
// adding row scoping: a driver's home is their own assigned agenda, which is a DIFFERENT projection
// of different data, and it belongs behind its own route rather than as a role branch here. Same
// stance as `/preferences`.
router.get("/", verifyJwt, isGrantedRoles([RolesEnum.Admin]), getDashboard);

export default router;
