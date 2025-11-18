import { Router } from 'express';
import { healthCheck } from './health.controller';

const router = Router();

// region Public Routes
router.get('/check', healthCheck);
// endregion

export default router;
