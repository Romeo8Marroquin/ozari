import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createCatalogRow,
  deleteCatalogRow,
  getPreferences,
  updateCatalogRow,
  updatePreferenceSettings,
} from "./preferences.controller.js";
import {
  validateCatalogRow,
  validateUpdatePreferenceSettings,
} from "./preferences.validator.js";

const router: RouterType = Router();

// **STRICTLY Admin, every route.** These endpoints change how the whole business behaves — the
// spacing rule between deliveries, how long goods are washed, which event types exist. A Driver
// reports what happened; a Client places orders; neither configures the system. The role check runs
// BEFORE each validator so a non-admin is denied without touching the database.
const adminOnly = isGrantedRoles([RolesEnum.Admin]);

// Region: the whole screen in one read — settings + every manageable catalog + the municipalities the
// zone form picks from. Inactive rows ARE included: this is where `isActive` is edited.
router.get("/", verifyJwt, adminOnly, getPreferences);

// Region: the scalar settings. Declarative (the full editable set), and the response carries the
// RELOADED values so the client shows what the system will actually read.
router.put(
  "/settings",
  verifyJwt,
  adminOnly,
  validateUpdatePreferenceSettings,
  updatePreferenceSettings,
);

// Region: the manageable seeded lookups, one set of routes for all six (see `preferences.catalogs.ts`
// — adding a catalog is one registry entry, never a new route). `:catalog` is validated against the
// registry and answers 404 for anything unlisted, which includes the lookups deliberately kept
// unmanageable (roles, currencies, business types…): code branches on their ids.
router.post("/catalogs/:catalog", verifyJwt, adminOnly, validateCatalogRow, createCatalogRow);
router.put("/catalogs/:catalog/:id", verifyJwt, adminOnly, validateCatalogRow, updateCatalogRow);
// No body to validate: deletion is decided by what REFERENCES the row, not by what was sent.
router.delete("/catalogs/:catalog/:id", verifyJwt, adminOnly, deleteCatalogRow);

export default router;
