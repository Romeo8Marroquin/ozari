import { Router } from "express";
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/userController";
import { validateCreateUser } from "../validators/userValidators";
import { disableEndpoint } from "../middlewares/disabledMiddleware";

const router = Router();

router.get("/", disableEndpoint, getUsers);
router.get("/:id", disableEndpoint, getUser);
router.post("/", validateCreateUser, createUser);
router.put("/:id", disableEndpoint, updateUser);
router.delete("/:id", disableEndpoint, deleteUser);

export default router;
