import { createApp } from "./app.js";
import { initializeI18n } from "./config/i18n.js";
import { logger } from "./config/logger.js";
import { disconnectPrisma } from "./services/prisma.service.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const HOST = process.env["API_HOST"] ?? "localhost";

async function startServer() {
  try {
    // Initialize i18n before starting server
    logger.info("Initializing i18n...");
    await initializeI18n();
    logger.info("i18n initialized successfully");

    const app = createApp();

    const server = app.listen(PORT, HOST, () => {
      logger.info(`Server started successfully`);
      logger.info(`Environment: ${process.env["NODE_ENV"] ?? "development"}`);
      logger.info(`Listening on http://${HOST}:${PORT}`);
      logger.info(`API base path: ${process.env["BASE_PATH"] ?? "/api"}`);
    });

    // Shutdown handling
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting shutdown...`);

      server.close(async () => {
        logger.info("HTTP server closed");

        try {
          await disconnectPrisma();
          logger.info("Shutdown completed");
          process.exit(0);
        } catch (error) {
          logger.error("Error during shutdown", { error });
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    // Listen for termination signals
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

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

startServer();
