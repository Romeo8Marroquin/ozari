import { Router } from 'express';

import {
  createProduct,
  deleteProduct,
  getAllProducts,
  getProductById,
  updateProduct,
} from '../controllers/productsController.js';
import { verifyJwt } from '../middlewares/authMiddleware.js';
import { isGrantedRoles } from '../middlewares/roleMiddleware.js';
import { RolesEnum } from '../models/enums/rolesEnum.js';
import { validateCreateProduct } from '../validators/productsValidators.js';

const router = Router();

// region Role Protected Routes
router.post(
  '/create',
  verifyJwt,
  validateCreateProduct,
  isGrantedRoles([RolesEnum.Admin]),
  createProduct,
);
router.put('/update/:id', verifyJwt, isGrantedRoles([RolesEnum.Admin]), updateProduct);
router.delete('/delete/:id', verifyJwt, isGrantedRoles([RolesEnum.Admin]), deleteProduct);
// endregion

// region Protected Routes
router.get('/all', verifyJwt, getAllProducts);
router.get('/all/:id', verifyJwt, getProductById);
// endregion

export default router;
