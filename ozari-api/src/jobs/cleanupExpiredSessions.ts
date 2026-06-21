import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";

/**
 * Cleanup Expired Sessions Job
 *
 * Purpose: Remove expired and old inactive JWT sessions from the database
 *
 * Schedule: Run daily via cron job or scheduled task
 *
 * Cleanup Rules:
 * 1. Delete sessions that have expired (expiresAt <= now)
 * 2. Delete inactive sessions older than 7 days (soft delete cleanup)
 *
 * Usage:
 * - Manual: `pnpm run cleanup:sessions`
 * - Cron: Add to crontab or use node-cron
 * - Cloud: Use Cloud Scheduler or Cloud Run Jobs
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const prismaClient = await getPrismaClient();
    const now = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    logger.info("[Cleanup Job] Starting expired sessions cleanup");

    // Delete sessions that match cleanup criteria
    const result = await prismaClient.jwtSession.deleteMany({
      where: {
        OR: [
          // Expired sessions (regardless of active status)
          { expiresAt: { lte: now } },
          // Old inactive sessions (already rotated or revoked)
          // Note: JwtSession model doesn't have createdAt, so we use issuedAt
          {
            isActive: false,
            issuedAt: { lte: sevenDaysAgo },
          },
        ],
      },
    });

    logger.info(
      `[Cleanup Job] Successfully cleaned up ${result.count} expired/inactive sessions`,
    );

    return;
  } catch (error) {
    logger.error("[Cleanup Job] Failed to cleanup expired sessions", error);
    throw error;
  }
}

/**
 * Manual execution when running this file directly
 * Usage: NODE_ENV=production tsx src/jobs/cleanupExpiredSessions.ts
 */
/* c8 ignore start */
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupExpiredSessions()
    .then(() => {
      logger.info("[Cleanup Job] Job completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("[Cleanup Job] Job failed", error);
      process.exit(1);
    });
}
/* c8 ignore stop */
