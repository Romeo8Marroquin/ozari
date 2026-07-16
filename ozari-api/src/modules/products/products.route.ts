import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createProduct,
  createProductImageUploads,
  deleteProduct,
  getProductById,
  getProductCatalog,
  getProducts,
  updateProduct,
} from "./products.controller.js";
import {
  validateCreateProduct,
  validateCreateProductImageUploads,
  validateDeleteProduct,
  validateUpdateProduct,
} from "./products.validator.js";

const router: RouterType = Router();

// Region: Role-protected reads — Admin + Client only (the response is still role-projected in the
// controller). Drivers get a 403: a driver's job is deliveries, not the catalog (Epic-2A, owner
// decision 2026-07-15) — and any future role is denied until explicitly granted (fail-closed).
// `/catalog` is declared before `/:id` so it never matches as a param.
const canReadProducts = isGrantedRoles([RolesEnum.Admin, RolesEnum.Client]);
router.get("/", verifyJwt, canReadProducts, getProducts);
router.get("/catalog", verifyJwt, canReadProducts, getProductCatalog);
router.get("/:id", verifyJwt, canReadProducts, getProductById);

// Region: Role-protected writes (Admin only). The cheap DB-free role check runs BEFORE the
// validator (which hits the DB for lookups) — a non-admin is denied without a single query.
router.post(
  "/",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateCreateProduct,
  createProduct,
);

// Presigned R2 PUT URLs for gallery uploads (the browser uploads straight to R2, then references
// the returned keys in the create body). Same Admin-only guard as the create it feeds.
router.post(
  "/images/upload-url",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateCreateProductImageUploads,
  createProductImageUploads,
);

// Declarative full-state update (the RECONCILE design): the body carries the product's FINAL
// desired state — scalars + details + gallery — and the backend diffs in one transaction. Same
// cheap-role-check-first ordering as create.
router.put(
  "/:id",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateUpdateProduct,
  updateProduct,
);

// Deletion under the NO-TRASH policy: the row tombstones (soft) only when order history references
// it; otherwise it hard-deletes — details/images rows and the R2 objects go either way.
router.delete(
  "/:id",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateDeleteProduct,
  deleteProduct,
);

export default router;
