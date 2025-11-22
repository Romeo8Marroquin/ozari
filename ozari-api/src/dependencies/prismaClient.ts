import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from './winstonConfig';
import i18next from 'i18next';
import { PrismaClient } from '@src/generated/prisma/client';

declare global {
  var prismaInstance: PrismaClient | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  const error = new Error(i18next.t('api.database.genericError'));
  logger.error(i18next.t('api.database.logs.dbUrlNotDefined'), error);
  throw new Error(i18next.t('api.database.genericError'));
}

const adapter = new PrismaPg({
  connectionString,
});

export const prismaClient: PrismaClient =
  global.prismaInstance ?? (global.prismaInstance = new PrismaClient({ adapter }));

prismaClient
  .$connect()
  .then(() => {
    logger.info(i18next.t('api.database.connected'));
  })
  .catch((error) => {
    logger.error(i18next.t('api.database.logs.databaseConnectionError'), error);
  });
