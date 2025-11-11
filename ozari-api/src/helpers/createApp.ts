import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import i18next from 'i18next';
import FilesystemBackend from 'i18next-fs-backend/cjs';
import * as i18nmiddleware from 'i18next-http-middleware';
import path from 'node:path';

import { logger } from '@deps/winstonConfig.js';
import { LoggerStorage } from '@models/common/logModel.js';
import { ProcessesEnum } from '@models/enums/processesEnum.js';
import { asyncLocalStorage } from '@src/app';
import { applicationConfig } from '@src/applicationConfig';

export function createApp(basePath: string, router: Router) {
  const app = express();

  // region Middlewares
  async function initI18n() {
    await i18next
      .use(FilesystemBackend)
      .use(i18nmiddleware.LanguageDetector)
      .init({
        backend: {
          loadPath: path.join(__dirname, 'locales', '{{lng}}', '{{ns}}.json'),
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
  }
  void initI18n(); // NOSONAR
  const allowedOrigin = process.env.API_HOST;
  const allowedPort = process.env.API_PORT;
  const frontendDomain = process.env.APP_HOST;
  if (!allowedOrigin) {
    logger.error(i18next.t('api.cors.logs.originNotDefined', { origin: allowedOrigin }));
    process.exit(ProcessesEnum.CORS_ORIGIN_ERROR);
  }
  if (!allowedPort) {
    logger.error(i18next.t('api.cors.logs.portError', { port: allowedPort }));
    process.exit(ProcessesEnum.PORT_ERROR);
  }
  if (!frontendDomain) {
    logger.error(i18next.t('api.server.logs.appHostError', { host: frontendDomain }));
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
  app.set('trust proxy', 1);
  app.use(rateLimit({ max: 100, windowMs: 15 * 60 * 1000 }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin === `${allowedOrigin}:${allowedPort}`) {
          callback(null, true);
          return;
        }
        logger.error(i18next.t('api.cors.logs.originBlocked', { origin }));
        callback(new Error(i18next.t('api.cors.originInvalid')), false);
      },
    }),
  );
  app.use((req, _, next) => {
    const context: LoggerStorage = {
      body: req.body as object,
      hostname: req.hostname,
      ips: req.ips,
      method: req.method,
      originalUrl: req.originalUrl,
      params: req.params,
      protocol: req.protocol,
      query: req.query,
      requestUuid: crypto.randomUUID(),
      timestamp: new Date(),
      userAgent: req.headers['user-agent'],
    };
    asyncLocalStorage.run(context, () => {
      logger.verbose(i18next.t('api.server.logs.initRequest'), { ...context, firstLog: true });
      next();
    });
  });
  // endregion

  // region Routes
  const apiRouter = Router();
  apiRouter.use(basePath, router);
  app.use(applicationConfig.basePath, apiRouter);
  // endregion

  return app;
}
