import { createLambdaHandler } from '@helpers/createApp';
import router from './auth.route';

export const handler = createLambdaHandler('/auth', router);
