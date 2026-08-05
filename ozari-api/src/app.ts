import crypto from "node:crypto";
import express, { Router } from "express";
import type { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import i18next from "i18next";
import rateLimit from "express-rate-limit";

import { i18nmiddleware } from "./config/i18n.js";
import { getAppHost } from "./config/environment.js";
import { logger } from "./config/logger.js";
import { asyncLocalStorage, type RequestContext } from "./config/context.js";
import { sanitizeSensitiveData } from "./helpers/utils.js";
import { validateApiKey } from "./middlewares/apiKey.middleware.js";
import { appConfig } from "./config/app.js";
import { HttpEnum } from "./models/enums/httpEnum.js";
import type { AppError } from "./models/common/error.js";

import authRouter from "./modules/auth/auth.route.js";
import clientRegistriesRouter from "./modules/clientRegistries/clientRegistries.route.js";
import dashboardRouter from "./modules/dashboard/dashboard.route.js";
import ordersRouter from "./modules/orders/orders.route.js";
import preferencesRouter from "./modules/preferences/preferences.route.js";
import productsRouter from "./modules/products/products.route.js";
import healthRouter from "./modules/health/health.route.js";
import { mountApiDocs } from "./docs/swagger.js";

export function createApp(): Express {
  const app = express();

  // Interactive API docs are mounted first, BEFORE the security chain, so the Swagger UI and its
  // assets are reachable without an API key and aren't blocked by the strict global CSP.
  mountApiDocs(app);

  configureMiddlewares(app);

  configureRoutes(app);

  configureErrorMiddleware(app);

  return app;
}

function configureMiddlewares(app: Express): void {
  const frontendDomain = getAppHost();

  if (!frontendDomain) {
    logger.error("APP_HOST environment variable is not defined");
    process.exit(1);
  }

  // Trust proxy for Cloud Run and other reverse-proxy deployments.
  //
  // The number is a HOP COUNT, and it decides what `req.ip` is — which is what every rate limiter
  // keys on. Deployed traffic now arrives through Cloudflare (a Worker fronts the custom domain,
  // DEPLOYMENT.md §3c), so `X-Forwarded-For` reads `<client>, <cloudflare-edge>` by the time Express
  // sees it: Cloudflare forwards the client and Google's front end appends its immediate peer. One
  // trusted hop therefore still resolves the real client.
  //
  // If a future change puts another proxy in front, RAISE THIS — a too-low count makes `req.ip`
  // collapse to the proxy's address, which silently turns per-IP limits into one global bucket that
  // throttles every user at once. Verified by the two-device check in §3c.4.
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
  // Rate Limiters - Different limits for different endpoint types.
  // NOTE: the strict CREDENTIAL limiter (10/min, brute-force protection) lives in
  // `auth.route.ts` and is applied PER-ROUTE to the endpoints that verify a secret — the /auth
  // router as a whole rides the authenticated tier, so session reads like `GET /auth/me` (which
  // the panel consults on every mount/focus) don't burn the credential budget.

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
      // `Authorization` carries the access token; `x-csrf-token` carries the CSRF token.
      // Both must be exposed so the browser FE can read them from cross-origin responses.
      exposedHeaders: ["Authorization", "x-csrf-token"],
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
    public: ReturnType<typeof rateLimit>;
    authenticated: ReturnType<typeof rateLimit>;
  };

  // Module routes with appropriate rate limiters
  // Health check - public limiter (moderate)
  apiRouter.use("/health", rateLimiters["public"], healthRouter);

  // Auth endpoints — authenticated tier for the router; the CREDENTIAL endpoints inside it stack
  // their own strict 10/min limiter (see auth.route.ts), so /me and /signout never starve on it.
  apiRouter.use("/auth", rateLimiters["authenticated"], authRouter);

  // Products endpoints - authenticated limiter (lenient)
  apiRouter.use("/products", rateLimiters["authenticated"], productsRouter);

  // Orders endpoints - authenticated limiter (lenient); the routes themselves are Admin-only
  apiRouter.use("/orders", rateLimiters["authenticated"], ordersRouter);

  // Walk-in client registries - authenticated limiter; strictly Admin inside the router
  apiRouter.use("/client-registries", rateLimiters["authenticated"], clientRegistriesRouter);

  // System preferences (scalar settings + the manageable seeded catalogs) - authenticated limiter;
  // STRICTLY Admin inside the router, every route
  apiRouter.use("/preferences", rateLimiters["authenticated"], preferencesRouter);

  // The admin home screen - authenticated limiter; STRICTLY Admin inside the router. Deliberately on
  // the lenient tier: the panel re-reads it on every focus and on a slow interval, exactly like /me,
  // and the credential tier would starve it
  apiRouter.use("/dashboard", rateLimiters["authenticated"], dashboardRouter);

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
