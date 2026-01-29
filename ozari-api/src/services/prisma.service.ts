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
    });

    const client = new PrismaClient({ adapter });

    globalThis.prismaInstance = client;

    await client.$connect();
    logger.info("Database connected successfully");

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
