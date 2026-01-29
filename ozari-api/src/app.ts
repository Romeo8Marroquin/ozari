import express, { Router } from "express";
import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import i18next from "i18next";
import { i18nmiddleware } from "./config/i18n.js";
import { logger } from "./config/logger.js";
import { asyncLocalStorage, type RequestContext } from "./config/context.js";
import { sanitizeSensitiveData } from "./helpers/utils.js";
import { validateApiKey } from "./middlewares/apiKey.middleware.js";
import { appConfig } from "./config/app.js";
import type { AppError } from "./models/common/error.js";

import authRouter from "./modules/auth/auth.route.js";
import productsRouter from "./modules/products/products.route.js";
import healthRouter from "./modules/health/health.route.js";

export function createApp(): Express {
  const app = express();

  configureMiddlewares(app);

  configureRoutes(app);

  configureErrorMiddleware(app);

  return app;
}

function configureMiddlewares(app: Express): void {
  const frontendDomain = process.env["APP_HOST"];

  if (!frontendDomain) {
    logger.error("APP_HOST environment variable is not defined");
    process.exit(1);
  }

  // Trust proxy (for Railway/Cloud deployment)
  app.set("trust proxy", 1);

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

  const allowedOrigins = new Set([frontendDomain]);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, Postman, etc.)
        if (!origin) {
          logger.info("Request without origin (Server-to-Server / Tooling)");
          return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
          logger.info(`CORS: Origin allowed - ${origin}`);
          return callback(null, true);
        }

        logger.error(`CORS: Origin blocked - ${origin}`);
        const corsError = new Error(
          `Origin ${origin} is not allowed by CORS`,
        ) as AppError;
        corsError.status = 403;
        callback(corsError);
      },
      credentials: true,
    }),
  );

  // Body parsing
  app.use(cookieParser());
  app.use(express.json({ limit: "10kb" }));

  app.use(validateApiKey);

  app.use((req, _res, next) => {
    const requestUuid =
      (req.headers["x-request-id"] as string) ?? crypto.randomUUID();

    const context: RequestContext = {
      requestUuid,
      method: req.method,
      originalUrl: req.originalUrl,
      hostname: req.hostname,
      ips: req.ips,
      protocol: req.protocol,
      timestamp: new Date(),
      userAgent: req.headers["user-agent"],
      body: sanitizeSensitiveData(req.body),
      query: sanitizeSensitiveData(req.query),
      params: req.params,
    };

    asyncLocalStorage.run(context, () => {
      logger.verbose("Request initialized", {
        requestUuid: context.requestUuid,
        method: context.method,
        url: context.originalUrl,
      });
      next();
    });
  });

  app.use(i18nmiddleware.handle(i18next));
}

function configureRoutes(app: Express): void {
  const apiRouter = Router();

  // Module routes
  apiRouter.use("/health", healthRouter);
  apiRouter.use("/auth", authRouter);
  apiRouter.use("/products", productsRouter);

  // Mount API router at base path
  app.use(appConfig.basePath, apiRouter);
}

function configureErrorMiddleware(app: Express): void {
  // 404 handler for undefined routes
  app.use((_, __, next) => {
    const error = new Error("Endpoint not found") as AppError;
    error.status = 404;
    next(error);
  });

  // Global error handler
  app.use(
    (err: AppError, _req: Request, res: Response, _next: NextFunction) => {
      const store = asyncLocalStorage.getStore();
      const status = err.status ?? 500;
      const isInternalError = status === 500;

      const errorContext = {
        message: err.message ?? "Unknown Error",
        errorName: err.name,
        statusCode: status,
        stack: isInternalError ? err.stack : undefined,
        context: store,
      };

      if (isInternalError) {
        logger.error(`Internal server error: ${err.message}`, errorContext);
      } else {
        logger.warn(err.message);
      }

      const clientMessage = isInternalError
        ? "Internal Server Error"
        : err.message;

      res.status(status).json({
        success: false,
        message: clientMessage,
        ...(process.env["NODE_ENV"] === "development" &&
          isInternalError && { stack: err.stack }),
      });
    },
  );
}
