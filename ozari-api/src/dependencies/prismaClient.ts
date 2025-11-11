import { PrismaClient } from '@prisma/client';
import i18next from 'i18next';

import { ProcessesEnum } from '@models/enums/processesEnum';
import { logger } from './winstonConfig';

export const prismaClient = new PrismaClient();
prismaClient
  .$connect()
  .then(() => {
    logger.info(i18next.t('api.database.connected'));
  })
  .catch((error: unknown) => { // NOSONAR
    logger.error(i18next.t('api.database.logs.databaseConnectionError', { error }));
    process.exit(ProcessesEnum.DB_CONNECTION_ERROR);
  });
