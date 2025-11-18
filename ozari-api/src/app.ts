import { Router } from 'express';

import { createApp } from '@helpers/createApp';
import authRouter from '@modules/auth/auth.route';
import healthRouter from '@modules/health/health.route';

const router = Router();
router.use('/health', healthRouter);
router.use('/auth', authRouter);
// apiRouter.use('/products', productsRouter);

const app = createApp('', router);

export default app;
