import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createProduct,
  createProductImageUploads,
  getProductById,
  getProductCatalog,
  getProducts,
} from "./products.controller.js";
import {
  validateCreateProduct,
  validateCreateProductImageUploads,
} from "./products.validator.js";

const router: RouterType = Router();

// Region: Protected reads — any authenticated role (the response is role-projected in the controller).
// `/catalog` is declared before `/:id` so it never matches as a param.
router.get("/", verifyJwt, getProducts);
router.get("/catalog", verifyJwt, getProductCatalog);
router.get("/:id", verifyJwt, getProductById);

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

// Region: remaining writes — WIP, not mounted until rebuilt against the new Product shape.
// router.put("/:id", verifyJwt, isGrantedRoles([RolesEnum.Admin]), validateUpdateProduct, updateProduct);
// router.delete("/:id", verifyJwt, isGrantedRoles([RolesEnum.Admin]), validateDeleteProduct, deleteProduct);

export default router;
