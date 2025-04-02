import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import i18next from 'i18next';
import FilesystemBackend from 'i18next-fs-backend';
import * as i18nmiddleware from 'i18next-http-middleware';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { ProcessesEnum } from './models/enums/processesEnum.js';
import usersRouter from './routes/userRoute.js';
const app = express();

// region Middlewares

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await i18next
  .use(FilesystemBackend)
  .use(i18nmiddleware.LanguageDetector)
  .init({
    backend: {
      loadPath: `${__dirname}\\locales\\{{lng}}\\{{ns}}.json`,
    },
    detection: {
      lookupHeader: 'accept-language',
      order: ['header'],
    },
    fallbackLng: 'es-GT',
    preload: ['es-GT'],
    supportedLngs: ['es-GT'],
  });

app.use(i18nmiddleware.handle(i18next, {}));
const allowedOrigin = process.env.API_HOST;
const frontendDomain = process.env.APP_HOST;
if (!allowedOrigin) {
  console.error(i18next.t('api.cors.logs.originNotDefined'));
  process.exit(ProcessesEnum.CORS_ORIGIN_ERROR);
}
if (!frontendDomain) {
  console.error(i18next.t('api.server.logs.appHostError', { host: frontendDomain }));
  process.exit(ProcessesEnum.APP_HOST_ERROR);
}
const cspDirectives = {
  connectSrc: ["'self'", frontendDomain],
  defaultSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  frameAncestors: ["'self'"],
  imgSrc: ["'self'", frontendDomain, 'data:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", frontendDomain],
  styleSrc: ["'self'", frontendDomain],
};

app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: 'deny' }));
app.use(rateLimit({ max: 100, windowMs: 15 * 60 * 1000 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (origin === allowedOrigin) {
        callback(null, true);
        return;
      }
      console.error(i18next.t('api.cors.logs.originBlocked', { origin }));
      callback(new Error(i18next.t('api.cors.originInvalid')), false);
    },
  }),
);
// endregion

// region Routes
app.use('/user', usersRouter);
// endregion

export default app;
