import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from './winstonConfig';
import i18next from 'i18next';
import { PrismaClient } from '@src/generated/prisma/client';
import { readFileSync } from 'node:fs';
import { getSecret } from '@helpers/ssmLoader';

declare global {
  var prismaInstance: PrismaClient | undefined;
  var prismaInitPromise: Promise<PrismaClient> | undefined;
}

async function initializePrismaClient(): Promise<PrismaClient> {
  if (globalThis.prismaInstance) {
    return globalThis.prismaInstance;
  }

  const connectionString = await getSecret('database_url');

  if (!connectionString) {
    const error = new Error(i18next.t('api.database.genericError'));
    logger.error(i18next.t('api.database.logs.dbUrlNotDefined'), error);
    throw new Error(i18next.t('api.database.genericError'));
  }

  const ca = readFileSync('certs/global-bundle.pem', 'utf8');
  console.log(ca);
  const adapter = new PrismaPg({
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
      servername: new URL(connectionString).hostname,
    },
  });

  const client = new PrismaClient({ adapter });
  globalThis.prismaInstance = client;

  await client.$connect();
  logger.info(i18next.t('api.database.connected'));

  return client;
}

export function getPrismaClient(): Promise<PrismaClient> {
  if (!globalThis.prismaInitPromise) {
    globalThis.prismaInitPromise = initializePrismaClient().catch((error) => {
      logger.error(i18next.t('api.database.logs.databaseConnectionError'), error);
      globalThis.prismaInitPromise = undefined;
      throw error;
    });
  }
  return globalThis.prismaInitPromise;
}
