import type { Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { isProductionEnvironment } from "@/config/environment.js";
import { logger } from "@/config/logger.js";
import { openApiDocument } from "./openapi.js";

export const DOCS_PATH = "/api/docs";
export const DOCS_JSON_PATH = "/api/docs.json";

/**
 * Mount the interactive API reference (Swagger UI) and the raw OpenAPI JSON.
 *
 * Called at the very start of `createApp`, BEFORE the security chain, so the UI and its assets are
 * reachable without an API key and are not blocked by the global `default-src 'none'` CSP.
 *
 * Interactive docs are a non-production convenience (local + staging). Production intentionally
 * serves nothing here until the team decides to expose it — the spec itself carries no secrets, so
 * it can always be shared as source or generated on demand.
 */
export function mountApiDocs(app: Express): void {
  if (isProductionEnvironment()) {
    return;
  }

  // The raw spec — useful for client codegen and external viewers.
  app.get(DOCS_JSON_PATH, (_req, res) => {
    res.json(openApiDocument);
  });

  // Swagger UI ships inline styles/scripts and data: images, which the global CSP forbids. Give the
  // docs routes a self-contained, relaxed CSP instead of loosening it app-wide.
  const docsCsp = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  });

  app.use(
    DOCS_PATH,
    docsCsp,
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Ozari API — Reference",
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "list",
        tryItOutEnabled: true,
      },
    }),
  );

  logger.info(`API documentation available at ${DOCS_PATH} (spec: ${DOCS_JSON_PATH})`);
}
