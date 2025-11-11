import { createApp } from '@helpers/createApp';
import serverless from 'serverless-http';

import router from './route';

const app = createApp('/auth', router);

export const handler = serverless(app);
