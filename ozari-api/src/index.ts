import i18next from 'i18next';

import app from './app.js';
import { prismaClient } from './database/databaseClient.js';
import { ProcessesEnum } from './models/enums/processesEnum.js';

const port = process.env.API_PORT;
const host = process.env.API_HOST;
if (!host) {
  console.error(i18next.t('api.server.logs.hostError', { host }));
  process.exit(ProcessesEnum.HOST_ERROR);
}
if (!port) {
  console.error(i18next.t('api.server.logs.portError', { port }));
  process.exit(ProcessesEnum.PORT_ERROR);
}
const server = app.listen(port, () => {
  console.log(i18next.t('api.server.logs.serverRunning', { host, port }));
});

const shutdownDatabase = async () => {
  console.log(i18next.t('api.database.logs.dbDisconnection'));
  await prismaClient.$disconnect();
  server.close(() => {
    console.log(i18next.t('api.server.logs.serverClosed'));
    process.exit(ProcessesEnum.SUCCESS);
  });
};

process.on('SIGINT', () => {
  shutdownDatabase().catch((error: unknown) => {
    console.error(i18next.t('api.database.logs.databaseShutdownError', { error }));
    process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
  });
});

process.on('SIGTERM', () => {
  shutdownDatabase().catch((error: unknown) => {
    console.error(i18next.t('api.database.logs.databaseShutdownError', { error }));
    process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
  });
});
