import { Router } from 'express';

import {
  createUser,
  getAllUsers,
  refreshToken,
  signInUser,
  signOutUser,
} from '../controllers/userController.js';
import { verifyJwt } from '../middlewares/authMiddleware.js';
import { isGrantedRoles } from '../middlewares/roleMiddleware.js';
import { RolesEnum } from '../models/enums/rolesEnum.js';
import { validateCreateUser, validateSignIn } from '../validators/userValidators.js';

const router = Router();

// region Protected Routes
router.get('/all', verifyJwt, isGrantedRoles([RolesEnum.Admin]), getAllUsers);
router.get('/signout', verifyJwt, signOutUser);
// endregion

// region Public Routes
router.post('/', validateCreateUser, createUser);
router.post('/signin', validateSignIn, signInUser);
router.get('/refresh', refreshToken);
// endregion

export default router;
