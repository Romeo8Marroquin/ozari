import { Router } from 'express';

import {
  createProduct,
  deleteProduct,
  getAllProducts,
  updateProduct,
} from '../controllers/productsController.js';
import { verifyJwt } from '../middlewares/authMiddleware.js';
import { isGrantedRoles } from '../middlewares/roleMiddleware.js';
import { RolesEnum } from '../models/enums/rolesEnum.js';
import {
  validateCreateProduct,
  validateDeleteProduct,
  validateUpdateProduct,
} from '../validators/productsValidators.js';

const router = Router();

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
