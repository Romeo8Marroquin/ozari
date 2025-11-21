import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, NextFunction, Request, Response, Router } from 'express';
import helmet from 'helmet';
import i18next from 'i18next';
import FilesystemBackend from 'i18next-fs-backend/cjs';
import * as i18nmiddleware from 'i18next-http-middleware';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import serverless from 'serverless-http';

import { logger } from '@deps/winstonConfig.js';
import { LoggerStorage } from '@models/common/logModel.js';
import { ProcessesEnum } from '@models/enums/processesEnum.js';
import { applicationConfig } from '@src/applicationConfig';
import { sanitizeSensitiveData } from './utils';
import { UUID } from 'node:crypto';
import { AppError } from '@models/common/error';

export const asyncLocalStorage = new AsyncLocalStorage<LoggerStorage>();

export const i18nReady = (async () => {
  await i18next
    .use(FilesystemBackend)
    .use(i18nmiddleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(process.cwd(), 'src', 'locales', '{{lng}}', '{{ns}}.json'),
      },
      detection: {
        lookupHeader: 'accept-language',
        order: ['header'],
      },
      fallbackLng: 'es-GT',
      preload: ['es-GT'],
      supportedLngs: ['es-GT'],
      ns: ['translation'],
      defaultNS: 'translation',
      initImmediate: false,
    });
})();

function configureMiddlewares(app: Express) {
  const frontendDomain = process.env.APP_HOST;

  if (!frontendDomain) {
    logger.error(i18next.t('api.server.logs.appHostError', { host: frontendDomain }));
    process.exit(ProcessesEnum.APP_HOST_ERROR);
  }

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  const allowedOrigins = new Set([
    `${frontendDomain}`,
    // 'http://localhost:3000'
  ]);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          logger.info('Solicitud sin origen (Server-to-Server / Tooling)');
          return callback(null, true);
        }
        if (allowedOrigins.has(origin)) {
          logger.info(i18next.t('api.cors.origin', { origin }));
          return callback(null, true);
        }
        logger.error(i18next.t('api.cors.logs.originBlocked', { origin }));
        const corsError: AppError = new Error(i18next.t('api.cors.originInvalid', { origin }));
        corsError.status = 403;
        callback(corsError);
      },
      credentials: true,
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));

  app.use((req, _res, next) => {
    const requestUuid = (req.headers['x-request-id'] as UUID) ?? crypto.randomUUID();
    const context: LoggerStorage = {
      body: sanitizeSensitiveData(req.body),
      query: sanitizeSensitiveData(req.query),
      hostname: req.hostname,
      ips: req.ips,
      method: req.method,
      originalUrl: req.originalUrl,
      params: req.params,
      protocol: req.protocol,
      requestUuid,
      timestamp: new Date(),
      userAgent: req.headers['user-agent'],
    };

    asyncLocalStorage.run(context, () => {
      logger.verbose(i18next.t('api.server.logs.initRequest'), {
        requestUuid: context.requestUuid,
        method: context.method,
        url: context.originalUrl,
      });
      next();
    });
  });

  app.use(i18nmiddleware.handle(i18next, {}));
}

function configureErrorMiddleware(app: Express) {
  app.use((_, __, next) => {
    const error: AppError = new Error(i18next.t('api.server.errors.notFound'));
    error.status = 404;
    next(error);
  });

  app.use((err: AppError, _: Request, res: Response, __: NextFunction) => {
    const store = asyncLocalStorage.getStore();
    const status = err.status ?? 500;
    const isInternalError = status === 500;

    const errorContext = {
      message: err.message ?? 'Unknown Error',
      errorName: err.name,
      statusCode: status,
      stack: isInternalError ? err.stack : undefined,
      context: store,
    };

    if (isInternalError) {
      logger.error(
        i18next.t('middlewares.errorHandler.logs.internalError', { error: err.message }),
        errorContext,
      );
    } else {
      logger.warn(`Error ${status}: ${err.message}`, errorContext);
    }

    const clientMessage = isInternalError
      ? i18next.t('middlewares.errorHandler.internalError')
      : err.message;

    res.status(status).json({
      success: false,
      message: clientMessage,
    });
  });
}

export function createApp(basePath: string, router: Router): Express {
  const app = express();

  configureMiddlewares(app);

  const apiRouter = Router();
  apiRouter.use(basePath, router);
  app.use(applicationConfig.basePath, apiRouter);

  configureErrorMiddleware(app);

  return app;
}

export function createLambdaHandler(basePath: string, router: Router) {
  const app = createApp(basePath, router);
  const slsHandler = serverless(app);

  const handler = async (event: Object, context: Object) => {
    await i18nReady;
    return slsHandler(event, context);
  };

  return handler;
}
