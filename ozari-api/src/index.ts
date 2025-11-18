import dotenv from 'dotenv';
import i18next from 'i18next';
import serverless from 'serverless-http';
dotenv.config();

import { prismaClient } from '@deps/prismaClient';
import { logger } from '@deps/winstonConfig';
import { i18nReady } from '@helpers/createApp';
import { ProcessesEnum } from '@models/enums/processesEnum';
import app from '@src/app';

let server: ReturnType<typeof app.listen> | undefined;

const shutdownDatabase = async () => {
  logger.info(i18next.t('api.database.logs.dbDisconnection'));
  await prismaClient.$disconnect();
  server?.close(() => {
    logger.info(i18next.t('api.server.logs.serverClosed'));
    process.exit(ProcessesEnum.SUCCESS);
  });
};

if (process.env.API_ENV !== 'prod' && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  async function startHttpServer() {
    const port = process.env.API_PORT;
    const host = process.env.API_HOST;
    if (!host) {
      logger.error(i18next.t('api.server.logs.hostError', { host }));
      process.exit(ProcessesEnum.HOST_ERROR);
    }
    if (!port) {
      logger.error(i18next.t('api.server.logs.portError', { port }));
      process.exit(ProcessesEnum.PORT_ERROR);
    }
    await i18nReady;
    server = app.listen(port, () => {
      logger.info(i18next.t('api.server.logs.serverRunning', { host, port }));
    });

    process.on('SIGINT', () => {
      shutdownDatabase().catch((error: unknown) => {
        logger.error(i18next.t('api.database.logs.databaseShutdownError', { error }));
        process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
      });
    });

    process.on('SIGTERM', () => {
      shutdownDatabase().catch((error: unknown) => {
        logger.error(i18next.t('api.database.logs.databaseShutdownError', { error }));
        process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
      });
    });
  }
  void startHttpServer(); // NOSONAR
}

const handler = serverless(app);

export const globalHandler = async (event: Object, context: Object) => {
  await i18nReady;
  return handler(event, context);
};
