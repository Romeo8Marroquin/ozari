import { createLambdaHandler } from '@helpers/createApp';
import router from './route';

export const handler = createLambdaHandler('/auth', router);
