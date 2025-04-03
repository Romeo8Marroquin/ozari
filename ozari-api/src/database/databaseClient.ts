import { PrismaClient } from '@prisma/client';
import i18next from 'i18next';

import { logger } from '../logs/winstonConfig.js';
import { ProcessesEnum } from '../models/enums/processesEnum.js';

export const prismaClient = new PrismaClient();
prismaClient
  .$connect()
  .then(() => {
    logger.info(i18next.t('api.database.connected'));
  })
  .catch((error: unknown) => {
    logger.error(i18next.t('api.database.logs.databaseConnectionError', { error }));
    process.exit(ProcessesEnum.DB_CONNECTION_ERROR);
  });
