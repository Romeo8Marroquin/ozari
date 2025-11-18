import { Router } from 'express';

import authRouter from '@modules/auth/route';
import { createApp } from '@helpers/createApp';

const router = Router();
router.use('/auth', authRouter);
// apiRouter.use('/products', productsRouter);

const app = createApp('', router);

export default app;
