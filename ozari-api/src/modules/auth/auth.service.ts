import crypto from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { appConfig } from "@/config/app.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { setCsrfToken } from "@middlewares/csrf.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";

type PrismaClient = Awaited<ReturnType<typeof getPrismaClient>>;
type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

export interface SessionSubject {
  userId: number;
  userRole: RolesEnum;
  deviceUuid: string;
}

/**
 * Rotates the device session and issues a fresh access/refresh token pair.
 * The access token is returned in the Authorization header, the refresh token
 * in an HttpOnly cookie, and a new CSRF token is set. Shared by login and the
 * MFA login challenge so token issuance lives in one place.
 */
export async function issueAuthenticatedSession(
  prismaClient: PrismaClient,
  res: Response,
  { userId, userRole, deviceUuid }: SessionSubject,
): Promise<void> {
  const jwtSecret = process.env["JWT_SECRET"];
  const jwtRefreshSecret = process.env["JWT_REFRESH_SECRET"];

  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error("JWT secrets are not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const accessJti = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  const accessExp = now + appConfig.accessToken.expiresIn;
  const refreshExp = now + appConfig.refreshToken.expiresIn;

  const accessToken = jwt.sign(
    {
      jti: accessJti,
      iat: now,
      deviceUuid,
      tokenType: TokenEnum.ACCESS_TOKEN,
      userId,
      userRole,
    },
    jwtSecret,
    appConfig.accessToken as jwt.SignOptions,
  );
  const refreshToken = jwt.sign(
    {
      jti: refreshJti,
      iat: now,
      deviceUuid,
      tokenType: TokenEnum.REFRESH_TOKEN,
      userId,
      userRole,
    },
    jwtRefreshSecret,
    appConfig.refreshToken as jwt.SignOptions,
  );

  await prismaClient.$transaction(async (transaction: PrismaTransaction) => {
    await transaction.$queryRaw`
      SELECT id
      FROM jwt_sessions
      WHERE device_uuid = ${deviceUuid}
        AND user_id = ${userId}
        AND is_active = true
      FOR UPDATE
    `;

    await transaction.jwtSession.deleteMany({
      where: { deviceUuid, isActive: true, userId },
    });
    await transaction.jwtSession.createMany({
      data: [
        {
          deviceUuid,
          expiresAt: new Date(accessExp * 1000),
          issuedAt: new Date(now * 1000),
          jti: accessJti,
          tokenTypeId: TokenEnum.ACCESS_TOKEN,
          userId,
        },
        {
          deviceUuid,
          expiresAt: new Date(refreshExp * 1000),
          issuedAt: new Date(now * 1000),
          jti: refreshJti,
          tokenTypeId: TokenEnum.REFRESH_TOKEN,
          userId,
        },
      ],
    });
  });

  setCsrfToken(res);

  res
    .header("authorization", `Bearer ${accessToken}`)
    .cookie("refresh-token", refreshToken, appConfig.cookieConfig);
}
