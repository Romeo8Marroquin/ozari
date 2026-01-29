import { Router, type Router as RouterType } from "express";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  createProduct,
  deleteProduct,
  getAllProducts,
  updateProduct,
} from "./products.controller.js";
import {
  validateCreateProduct,
  validateDeleteProduct,
  validateUpdateProduct,
} from "./products.validator.js";

const router: RouterType = Router();

// Region: Role Protected Routes
router.post(
  "/create",
  verifyJwt,
  validateCreateProduct,
  isGrantedRoles([RolesEnum.Admin]),
  createProduct,
);
router.put(
  "/update",
  verifyJwt,
  validateUpdateProduct,
  isGrantedRoles([RolesEnum.Admin]),
  updateProduct,
);
router.delete(
  "/delete",
  verifyJwt,
  validateDeleteProduct,
  isGrantedRoles([RolesEnum.Admin]),
  deleteProduct,
);

// Region: Protected Routes
router.get("/all", verifyJwt, getAllProducts);

export default router;
