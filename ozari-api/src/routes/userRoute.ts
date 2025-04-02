import { Router } from 'express';

import {
  createUser,
  deleteUser,
  getUser,
  getUsers,
  // updateUser,
} from '../controllers/userController.js';
import { disableEndpoint } from '../middlewares/disabledMiddleware.js';
import { validateCreateUser } from '../validators/userValidators.js';

const router = Router();

router.get('/', disableEndpoint, getUsers);
router.get('/:id', disableEndpoint, getUser);
router.post('/', validateCreateUser, createUser);
// router.put("/:id", disableEndpoint, updateUser);
router.delete('/:id', disableEndpoint, deleteUser);

export default router;
