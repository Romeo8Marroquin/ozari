import dotenv from 'dotenv';
dotenv.config();
import './telemetry/openTelemetry.js';
import i18next from 'i18next';

import app from './app.js';
import { prismaClient } from './database/databaseClient.js';
import { logger } from './logs/winstonConfig.js';
import { ProcessesEnum } from './models/enums/processesEnum.js';

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
const server = app.listen(port, () => {
  logger.info(i18next.t('api.server.logs.serverRunning', { host, port }));
});

const shutdownDatabase = async () => {
  logger.info(i18next.t('api.database.logs.dbDisconnection'));
  await prismaClient.$disconnect();
  server.close(() => {
    logger.info(i18next.t('api.server.logs.serverClosed'));
    process.exit(ProcessesEnum.SUCCESS);
  });
};

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
