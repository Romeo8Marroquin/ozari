import { Router, type Router as RouterType } from 'express';

import { verifyJwt } from '@middlewares/authMiddleware';
import { isGrantedRoles } from '@middlewares/roleMiddleware';
import { RolesEnum } from '@models/enums/rolesEnum';
import { createProduct, deleteProduct, getAllProducts, updateProduct } from './products.controller';
import {
  validateCreateProduct,
  validateDeleteProduct,
  validateUpdateProduct,
} from './products.validators';

const router: RouterType = Router();

// region Role Protected Routes
router.post(
  '/create',
  verifyJwt,
  validateCreateProduct,
  isGrantedRoles([RolesEnum.Admin]),
  createProduct,
);
router.put(
  '/update',
  verifyJwt,
  validateUpdateProduct,
  isGrantedRoles([RolesEnum.Admin]),
  updateProduct,
);
router.delete(
  '/delete',
  verifyJwt,
  validateDeleteProduct,
  isGrantedRoles([RolesEnum.Admin]),
  deleteProduct,
);
// endregion

// region Protected Routes
router.get('/all', verifyJwt, getAllProducts);
// endregion

export default router;
