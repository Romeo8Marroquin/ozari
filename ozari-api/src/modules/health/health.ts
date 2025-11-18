import { createLambdaHandler } from '@helpers/createApp';
import healthRouter from './health.route';

export const handler = createLambdaHandler('/health', healthRouter);
