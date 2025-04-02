import dotenv from 'dotenv';
import i18next from 'i18next';

import app from './app.js';
import { prismaClient } from './controllers/userController.js';
import { ProcessesEnum } from './models/enums/processesEnum.js';

dotenv.config();
const port = process.env.API_PORT;
const host = process.env.API_HOST;
if (!host) {
  console.error(i18next.t('api.logs.hostError', { host }));
  process.exit(ProcessesEnum.HOST_ERROR);
}
if (!port) {
  console.error(i18next.t('api.logs.portError', { port }));
  process.exit(ProcessesEnum.PORT_ERROR);
}
const server = app.listen(port, () => {
  console.log(i18next.t('api.logs.serverRunning', { host, port }));
});

const shutdownDatabase = async () => {
  console.log(i18next.t('api.logs.dbDisconnection'));
  await prismaClient.$disconnect();
  server.close(() => {
    console.log(i18next.t('api.logs.serverClosed'));
    process.exit(ProcessesEnum.SUCCESS);
  });
};

process.on('SIGINT', () => {
  shutdownDatabase().catch((error: unknown) => {
    console.error(i18next.t('api.logs.databaseShutdownError', { error }));
    process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
  });
});

process.on('SIGTERM', () => {
  shutdownDatabase().catch((error: unknown) => {
    console.error(i18next.t('api.logs.databaseShutdownError', { error }));
    process.exit(ProcessesEnum.DB_DISCONNECTION_ERROR);
  });
});
