import { Router, type Router as RouterType } from "express";
import { getTerms } from "./legal.controller.js";

const router: RouterType = Router();

// **PUBLIC, and deliberately the ONLY thing published here.** Somebody being asked to accept terms
// must be able to read them, and at that point they have no session — so this cannot live in the
// STRICTLY-Admin preferences router, and that router's invariant stays intact. Everything else the
// preferences screen manages (operational rules, catalogs, bank accounts) remains behind it; this
// endpoint exposes one paragraph the business wrote in order to show clients.
router.get("/terms", getTerms);

export default router;
