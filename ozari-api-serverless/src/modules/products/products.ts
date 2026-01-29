import { createLambdaHandler } from '@helpers/createApp';
import router from './products.route';

export const handler = createLambdaHandler('/products', router);
