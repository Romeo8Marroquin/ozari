import { Router, type Router as RouterType } from "express";
import rateLimit from "express-rate-limit";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { getDocumentImage } from "./documents.controller.js";
import { DOCUMENT_IMAGE_RATE_LIMIT } from "./documents.models.js";
import { validateDocumentImageQuery } from "./documents.validator.js";

const router: RouterType = Router();

// Its OWN limiter, mounted INSTEAD of the shared authenticated tier (see `app.ts`): one document
// asks once per distinct photo, so a long order must neither starve on, nor drain, the 100/min the
// rest of the panel spends. Still authenticated and Admin-only below.
const imageLimiter = rateLimit({
  windowMs: 60_000,
  limit: DOCUMENT_IMAGE_RATE_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

// Region: what the printed documents need from the server — **STRICTLY Admin**, because every
// document is (orders, quotes and damage reports are Admin-only). It widens together with them.
router.get(
  "/image",
  imageLimiter,
  verifyJwt,
  isGrantedRoles([RolesEnum.Admin]),
  validateDocumentImageQuery,
  getDocumentImage,
);

export default router;
