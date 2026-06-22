import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { issueAuthenticatedSession } from "./auth.service.js";
import { appConfig } from "@/config/app.js";
import { setCsrfToken } from "@middlewares/csrf.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@middlewares/csrf.middleware.js", () => ({
  setCsrfToken: vi.fn(),
}));

function buildRes(): Response {
  const res = {} as Response;
  res.header = vi.fn().mockReturnValue(res);
  res.cookie = vi.fn().mockReturnValue(res);
  return res;
}

function buildClient() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    jwtSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const client = {
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };
  return { client, tx };
}

beforeAll(() => {
  process.env["JWT_SECRET"] = "test-jwt-secret-0123456789-abcdefghij";
  process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret-0123456789-abcde";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issueAuthenticatedSession", () => {
  it("rotates the device session and issues access + refresh tokens", async () => {
    const { client, tx } = buildClient();
    const res = buildRes();

    await issueAuthenticatedSession(client as never, res, {
      userId: 1,
      userRole: RolesEnum.Client,
      deviceUuid: "device-1",
    });

    // Old rows for this device are cleared and exactly two new rows are created.
    expect(tx.jwtSession.deleteMany).toHaveBeenCalledWith({
      where: { deviceUuid: "device-1", isActive: true, userId: 1 },
    });
    const created = (tx.jwtSession.createMany as Mock).mock.calls[0]?.[0]
      .data as Array<{ tokenTypeId: number }>;
    expect(created).toHaveLength(2);
    expect(created.map((r) => r.tokenTypeId).sort()).toEqual([
      TokenEnum.ACCESS_TOKEN,
      TokenEnum.REFRESH_TOKEN,
    ]);

    // Access token in the Authorization header, refresh token in the cookie.
    const authHeader = (res.header as Mock).mock.calls.find(
      (c) => c[0] === "authorization",
    );
    expect(authHeader?.[1]).toMatch(/^Bearer .+/);
    const accessToken = (authHeader?.[1] as string).replace("Bearer ", "");
    const decodedAccess = jwt.verify(
      accessToken,
      process.env["JWT_SECRET"]!,
      {
        algorithms: [appConfig.accessToken.algorithm],
        audience: appConfig.accessToken.audience,
        issuer: appConfig.accessToken.issuer,
      },
    ) as jwt.JwtPayload & { tokenType: number; userId: number };
    expect(decodedAccess.tokenType).toBe(TokenEnum.ACCESS_TOKEN);
    expect(decodedAccess.userId).toBe(1);

    const cookieCall = (res.cookie as Mock).mock.calls.find(
      (c) => c[0] === "refresh-token",
    );
    expect(cookieCall).toBeDefined();
    const decodedRefresh = jwt.verify(
      cookieCall?.[1] as string,
      process.env["JWT_REFRESH_SECRET"]!,
      {
        algorithms: [appConfig.refreshToken.algorithm],
        audience: appConfig.refreshToken.audience,
        issuer: appConfig.refreshToken.issuer,
      },
    ) as jwt.JwtPayload & { tokenType: number };
    expect(decodedRefresh.tokenType).toBe(TokenEnum.REFRESH_TOKEN);

    expect(setCsrfToken).toHaveBeenCalledWith(res);
  });

  it("throws when JWT secrets are not configured", async () => {
    const original = process.env["JWT_SECRET"];
    delete process.env["JWT_SECRET"];
    const { client } = buildClient();
    const res = buildRes();

    await expect(
      issueAuthenticatedSession(client as never, res, {
        userId: 1,
        userRole: RolesEnum.Client,
        deviceUuid: "device-1",
      }),
    ).rejects.toThrow(/JWT secrets/i);

    process.env["JWT_SECRET"] = original;
  });
});
