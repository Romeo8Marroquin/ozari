import crypto from "node:crypto";
import express, { Router } from "express";
import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import i18next from "i18next";
import rateLimit from "express-rate-limit";

import { i18nmiddleware } from "./config/i18n.js";
import { logger } from "./config/logger.js";
import { asyncLocalStorage, type RequestContext } from "./config/context.js";
import { sanitizeSensitiveData } from "./helpers/utils.js";
import { validateApiKey } from "./middlewares/apiKey.middleware.js";
import { appConfig } from "./config/app.js";
import { HttpEnum } from "./models/enums/httpEnum.js";
import type { AppError } from "./models/common/error.js";

import authRouter from "./modules/auth/auth.route.js";
// import productsRouter from "./modules/products/products.route.js";
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
  // Rate Limiters - Different limits for different endpoint types
  // Strict limiter for authentication endpoints (prevent brute force)
  const authLimiter = rateLimit({
    windowMs: 60_000, // 1 minute
    limit: 10, // 10 requests per minute per IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many authentication requests, please try again later.",
  });

  // Moderate limiter for public endpoints
  const publicLimiter = rateLimit({
    windowMs: 60_000, // 1 minute
    limit: 30, // 30 requests per minute per IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
  });

  // Lenient limiter for authenticated endpoints
  const authenticatedLimiter = rateLimit({
    windowMs: 60_000, // 1 minute
    limit: 100, // 100 requests per minute per IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
  });

  // Store rate limiters in app.locals for use in routes
  app.locals["rateLimiters"] = {
    auth: authLimiter,
    public: publicLimiter,
    authenticated: authenticatedLimiter,
  };

  const allowedOrigins = new Set([frontendDomain]);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, Postman, etc.)
        if (!origin) {
          logger.debug("CORS: Request without origin (Server-to-Server)");
          return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
          logger.debug(`CORS: Origin allowed - ${origin}`);
          return callback(null, true);
        }

        // Only log blocked origins (security event)
        logger.warn(`CORS: Origin blocked - ${origin}`);
        const corsError = new Error(
          `Origin ${origin} is not allowed by CORS`,
        ) as AppError;
        corsError.status = 403;
        callback(corsError);
      },
      credentials: true,
      exposedHeaders: ["Authorization"],
    }),
  );

  // Body parsing with size limits
  app.use(cookieParser());
  app.use(express.json({ limit: "10kb" }));
  app.use(express.urlencoded({ extended: true, limit: "10kb" }));

  // Request timeout prevent hanging connections (30 seconds)
  app.use((req, res, next) => {
    const TIMEOUT_MS = 30_000; // 30 seconds

    // Set timeout on request
    req.setTimeout(TIMEOUT_MS, () => {
      logger.warn("Request timeout", {
        method: req.method,
        url: req.originalUrl,
        timeout: TIMEOUT_MS,
      });
      if (!res.headersSent) {
        res.status(HttpEnum.REQUEST_TIMEOUT).json({
          success: false,
          message: "Request timeout - operation took too long",
        });
      }
    });

    // Set timeout on response
    res.setTimeout(TIMEOUT_MS, () => {
      logger.warn("Response timeout", {
        method: req.method,
        url: req.originalUrl,
        timeout: TIMEOUT_MS,
      });
    });

    next();
  });

  app.use(validateApiKey);

  app.use((req, _res, next) => {
    let requestUuid = req.headers["x-request-id"] as string | undefined;
    if (requestUuid) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(requestUuid) || requestUuid.length > 36) {
        logger.warn(
          "Invalid X-Request-ID header received, generating new UUID",
          {
            invalidId: requestUuid.substring(0, 50), // Log first 50 chars only
          },
        );
        requestUuid = undefined;
      }
    }

    requestUuid = requestUuid ?? crypto.randomUUID();

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
  const rateLimiters = app.locals["rateLimiters"] as {
    auth: ReturnType<typeof rateLimit>;
    public: ReturnType<typeof rateLimit>;
    authenticated: ReturnType<typeof rateLimit>;
  };

  // Module routes with appropriate rate limiters
  // Health check - public limiter (moderate)
  apiRouter.use("/health", rateLimiters["public"], healthRouter);

  // Auth endpoints - strict limiter (prevent brute force)
  apiRouter.use("/auth", rateLimiters["auth"], authRouter);

  // Products endpoints - authenticated limiter (lenient)
  // apiRouter.use("/products", rateLimiters["authenticated"], productsRouter);

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
