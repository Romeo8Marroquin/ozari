import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createProduct,
  getProductCatalog,
  getProducts,
} from "./products.controller.js";
import { validateCreateProduct } from "./products.validator.js";

const router: RouterType = Router();

// Region: Protected reads — any authenticated role (the response is role-projected in the controller).
// `/catalog` must be declared before any future `/:id` route so it never matches as a param.
router.get("/", verifyJwt, getProducts);
router.get("/catalog", verifyJwt, getProductCatalog);

// Region: Role-protected writes (Admin only). The cheap DB-free role check runs BEFORE the
// validator (which hits the DB for lookups) — a non-admin is denied without a single query.
router.post(
  "/",
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateCreateProduct,
  createProduct,
);

// Region: remaining writes — WIP, not mounted until rebuilt against the new Product shape.
// router.put("/:id", verifyJwt, isGrantedRoles([RolesEnum.Admin]), validateUpdateProduct, updateProduct);
// router.delete("/:id", verifyJwt, isGrantedRoles([RolesEnum.Admin]), validateDeleteProduct, deleteProduct);

export default router;
