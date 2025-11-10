import { Router } from 'express';

import { createUser, getAllUsers, refreshToken, signInUser, signOutUser } from './controller';
import { validateCreateUser, validateSignIn } from './validator';
import { RolesEnum } from '../../models/enums/rolesEnum';
import { verifyJwt } from '../../middlewares/authMiddleware';
import { isGrantedRoles } from '../../middlewares/roleMiddleware';

const router = Router();

//region Role Protected Routes
router.get('/all', verifyJwt, isGrantedRoles([RolesEnum.Admin]), getAllUsers);
// endregion

// region Protected Routes
router.get('/signout', verifyJwt, signOutUser);
// endregion

// region Public Routes
router.post('/', validateCreateUser, createUser);
router.post('/signin', validateSignIn, signInUser);
router.get('/refresh', refreshToken);
// endregion

export default router;
