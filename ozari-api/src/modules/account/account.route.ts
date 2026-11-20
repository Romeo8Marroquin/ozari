import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import {
  getAccountPreferences,
  updateAccountPreferences,
} from "./account.controller.js";
import { validateUpdateAccountPreferences } from "./account.validator.js";

const router: RouterType = Router();

// **Every authenticated role, and only ever the CALLER's own row.** These are personal working
// preferences (how *I* fill an order), not business rules — those stay under the STRICTLY-Admin
// `/preferences`. There is no `:userId` anywhere: the token is the identity, so one person can never
// read or change another's. A role that never creates orders simply has nothing here that matters.
router.get("/preferences", verifyJwt, getAccountPreferences);
router.put("/preferences", verifyJwt, validateUpdateAccountPreferences, updateAccountPreferences);

export default router;
