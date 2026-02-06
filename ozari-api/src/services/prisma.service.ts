import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "@config/logger.js";

declare global {
  // eslint-disable-next-line no-var
  var prismaInstance: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaInitPromise: Promise<PrismaClient> | undefined;
}

async function initializePrismaClient(): Promise<PrismaClient> {
  if (globalThis.prismaInstance) {
    return globalThis.prismaInstance;
  }

  const connectionString = process.env["DATABASE_URL"];

  if (!connectionString) {
    const error = new Error("DATABASE_URL environment variable is not defined");
    logger.error("Database connection failed: DATABASE_URL not found", {
      error,
    });
    throw error;
  }

  try {
    const adapter = new PrismaPg({
      connectionString,
      ssl: { rejectUnauthorized: true },
      max: 20,
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 10000, // Fail fast if can't connect within 10 seconds
    });

    const client = new PrismaClient({
      adapter,
      // Enable query logging for development
      log:
        process.env["NODE_ENV"] === "development"
          ? ["query", "error", "warn"]
          : ["error", "warn"],
    });

    globalThis.prismaInstance = client;

    // Configure query logging based on environment
    const isDevelopment = process.env["NODE_ENV"] === "development";
    const slowQueryThreshold = 500; // ms - queries slower than this are considered slow

    if (isDevelopment) {
      // Development: Log all queries with details
      client.$on("query", (e) => {
        logger.debug("Database Query", {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
          target: e.target,
        });
      });
    } else {
      // Production: Only log slow queries
      client.$on("query", (e) => {
        if (e.duration > slowQueryThreshold) {
          logger.warn("Slow database query detected", {
            query: e.query,
            duration: `${e.duration}ms`,
            target: e.target,
            threshold: `${slowQueryThreshold}ms`,
          });
        }
      });
    }

    await client.$connect();
    logger.info("Database connected successfully", {
      environment: process.env["NODE_ENV"],
      queryLogging: isDevelopment ? "all queries" : "slow queries only",
      slowQueryThreshold: `${slowQueryThreshold}ms`,
    });

    return client;
  } catch (error) {
    logger.error("Failed to initialize Prisma Client", { error });
    throw new Error("Database connection failed");
  }
}

export function getPrismaClient(): Promise<PrismaClient> {
  if (!globalThis.prismaInitPromise) {
    globalThis.prismaInitPromise = initializePrismaClient().catch((error) => {
      logger.error("Database connection error", { error });
      // Reset promise so it can be retried
      globalThis.prismaInitPromise = undefined;
      throw error;
    });
  }

  return globalThis.prismaInitPromise;
}

export async function disconnectPrisma(): Promise<void> {
  if (globalThis.prismaInstance) {
    await globalThis.prismaInstance.$disconnect();
    globalThis.prismaInstance = undefined;
    globalThis.prismaInitPromise = undefined;
    logger.info("Database disconnected");
  }
}
