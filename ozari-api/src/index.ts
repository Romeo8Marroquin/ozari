import { createApp } from "./app.js";
import { getAppEnv, isDeployedEnvironment } from "./config/environment.js";
import { initializeI18n } from "./config/i18n.js";
import { logger } from "./config/logger.js";
import { disconnectPrisma } from "./services/prisma.service.js";

const isCloudRun = Boolean(process.env["K_SERVICE"]);
const shouldUseCloudRunDefaults = isCloudRun || isDeployedEnvironment();
const PORT = parseInt(process.env["PORT"] ?? (shouldUseCloudRunDefaults ? "8080" : "3000"), 10);
const HOST = process.env["API_HOST"] ?? (shouldUseCloudRunDefaults ? "0.0.0.0" : "localhost");

async function startServer() {
  try {
    // Initialize i18n before starting server
    logger.info("Initializing i18n...");
    await initializeI18n();
    logger.info("i18n initialized successfully");

    const app = createApp();

    const server = app.listen(PORT, HOST, () => {
      logger.info(`Server started successfully`);
      logger.info(`Environment: ${getAppEnv()}`);
      logger.info(`Listening on http://${HOST}:${PORT}`);
      logger.info(`API base path: ${process.env["BASE_PATH"] ?? "/api"}`);
    });

    // Shutdown handling
    const shutdown = (signal: string) => {
      logger.info(`${signal} received. Starting shutdown...`);

      server.close(() => {
        logger.info("HTTP server closed");

        disconnectPrisma()
          .then(() => {
            logger.info("Shutdown completed");
            process.exit(0);
          })
          .catch((error) => {
            logger.error("Error during shutdown", { error });
            process.exit(1);
          });
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    // Listen for termination signals
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception", { error });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection", { reason, promise });
      process.exit(1);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

startServer().catch((error) => {
  logger.error("Server startup failed", { error });
  process.exit(1);
});
