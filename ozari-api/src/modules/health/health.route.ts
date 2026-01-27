import { Router, type Router as RouterType } from 'express';

import { healthCheck } from './health.controller';

const router: RouterType = Router();

// region Public Routes
router.get('/check', healthCheck);
// endregion

export default router;
