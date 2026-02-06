import type { Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";

/**
 * Health check endpoint for Railway load balancer
 * Tests both application and database connectivity
 */
export const healthCheck = async (_: Request, res: Response): Promise<void> => {
  try {
    // Test database connectivity (critical for Railway health checks)
    const prismaClient = await getPrismaClient();
    await prismaClient.$queryRaw`SELECT 1`;

    logger.info(i18next.t("health.check.logs.serviceHealthy"));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("health.check.serviceHealthy"), {
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Health check failed - database unreachable", { error });
    sendOzariError(
      res,
      HttpEnum.SERVICE_UNAVAILABLE,
      "Service unhealthy - database connection failed",
    );
  }
};
