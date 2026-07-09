import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { forgotPassword, resetPassword } from "./auth.password.controller.js";
import { encryptKms, hashPassword } from "@helpers/encryption.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { logSecurityAudit } from "@/config/auditLogger.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({
  i18next: { t: vi.fn((key: string) => key) },
}));
vi.mock("@/config/auditLogger.js", () => ({
  logSecurityAudit: vi.fn(),
  AuditAction: { PASSWORD_CHANGED: "PASSWORD_CHANGED" },
}));
vi.mock("@/config/environment.js", () => ({
  getAppHost: vi.fn(() => "https://app.example.com"),
  isDeployedEnvironment: vi.fn(() => false),
}));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const { mailerSend } = vi.hoisted(() => ({ mailerSend: vi.fn() }));
vi.mock("@helpers/mailer.js", () => ({
  getMailer: () => ({ send: mailerSend }),
}));

const res = {} as Response;

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    emailKms: encryptKms("user@example.com"),
    fullNameKms: encryptKms("Test User"),
    passwordSha: "",
    isActive: true,
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const client = {
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    passwordResetToken: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    jwtSession: { deleteMany: vi.fn().mockResolvedValue(undefined) },
    $transaction: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  (getPrismaClient as Mock).mockResolvedValue(client);
  return client;
}

const req = (body: unknown): Request =>
  ({ body, headers: {}, ip: "1.2.3.4" }) as unknown as Request;

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

beforeEach(() => {
  vi.clearAllMocks();
  (isDeployedEnvironment as Mock).mockReturnValue(false);
});

describe("forgotPassword", () => {
  it("returns a generic success without minting a token for an unknown email", async () => {
    const client = mockPrisma();
    client.user.findFirst.mockResolvedValue(null);

    await forgotPassword(req({ email: "nobody@example.com" }), res);

    expect(client.$transaction).not.toHaveBeenCalled();
    expect(mailerSend).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("mints a token and emails the reset link for a known email", async () => {
    const client = mockPrisma();
    client.user.findFirst.mockResolvedValue(buildUser());

    await forgotPassword(req({ email: "user@example.com" }), res);

    // Old tokens dropped + a fresh one created, atomically.
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.passwordResetToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          tokenSha: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(mailerSend).toHaveBeenCalledTimes(1);
    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("still returns the generic success when the reset email fails", async () => {
    const client = mockPrisma();
    client.user.findFirst.mockResolvedValue(buildUser());
    mailerSend.mockRejectedValueOnce(new Error("smtp down"));

    await forgotPassword(req({ email: "user@example.com" }), res);

    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("skips resending (no new token, no email) within the cooldown window", async () => {
    const client = mockPrisma();
    client.user.findFirst.mockResolvedValue(buildUser());
    // A token minted just now -> still inside the cooldown.
    client.passwordResetToken.findFirst.mockResolvedValue({ userId: 1, createdAt: new Date() });

    await forgotPassword(req({ email: "user@example.com" }), res);

    expect(client.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mailerSend).not.toHaveBeenCalled();
    // Still the SAME generic success (an attacker learns nothing from the throttle).
    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("resends when the previous request is older than the cooldown", async () => {
    const client = mockPrisma();
    client.user.findFirst.mockResolvedValue(buildUser());
    client.passwordResetToken.findFirst.mockResolvedValue({
      userId: 1,
      createdAt: new Date(Date.now() - 10 * 60_000), // 10 min ago -> past the 60s cooldown
    });

    await forgotPassword(req({ email: "user@example.com" }), res);

    expect(client.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(mailerSend).toHaveBeenCalledTimes(1);
  });

  it("returns 500 on an unexpected error", async () => {
    (getPrismaClient as Mock).mockRejectedValueOnce(new Error("db down"));

    await forgotPassword(req({ email: "user@example.com" }), res);

    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });
});

describe("resetPassword", () => {
  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 60_000);

  it("rejects an unknown token with a generic 400", async () => {
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue(null);

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(sendOzariError).toHaveBeenCalledWith(res, HttpEnum.BAD_REQUEST, expect.any(String));
  });

  it("rejects an expired token", async () => {
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: past(),
    });

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(sendOzariError).toHaveBeenCalledWith(res, HttpEnum.BAD_REQUEST, expect.any(String));
  });

  it("rejects when the token's user no longer exists / is inactive", async () => {
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: future(),
    });
    client.user.findFirst.mockResolvedValue(null);

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(sendOzariError).toHaveBeenCalledWith(res, HttpEnum.BAD_REQUEST, expect.any(String));
  });

  it("rejects reusing the current password", async () => {
    const passwordSha = await hashPassword("CurrentPass123!");
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: future(),
    });
    client.user.findFirst.mockResolvedValue(buildUser({ passwordSha }));

    await resetPassword(
      req({
        token: "x",
        newPassword: "CurrentPass123!",
        confirmPassword: "CurrentPass123!",
      }),
      res,
    );

    expect(client.$transaction).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(res, HttpEnum.BAD_REQUEST, expect.any(String));
  });

  it("resets the password, revokes ALL sessions, and confirms by email", async () => {
    const passwordSha = await hashPassword("OldPass123!");
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: future(),
    });
    client.user.findFirst.mockResolvedValue(buildUser({ passwordSha }));

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    // Password set + tokens consumed + EVERY session revoked, in one transaction.
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.jwtSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
    expect(mailerSend).toHaveBeenCalledTimes(1);
    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("still succeeds when the confirmation email fails", async () => {
    const passwordSha = await hashPassword("OldPass123!");
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: future(),
    });
    client.user.findFirst.mockResolvedValue(buildUser({ passwordSha }));
    mailerSend.mockRejectedValueOnce(new Error("smtp down"));

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(sendOzariSuccess).toHaveBeenCalledWith(res, HttpEnum.OK, expect.any(String));
  });

  it("audit-logs the reset in a deployed environment", async () => {
    (isDeployedEnvironment as Mock).mockReturnValue(true);
    const passwordSha = await hashPassword("OldPass123!");
    const client = mockPrisma();
    client.passwordResetToken.findUnique.mockResolvedValue({
      userId: 1,
      expiresAt: future(),
    });
    client.user.findFirst.mockResolvedValue(buildUser({ passwordSha }));

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(logSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PASSWORD_CHANGED", userId: 1, success: true }),
    );
  });

  it("returns 500 on an unexpected error", async () => {
    (getPrismaClient as Mock).mockRejectedValueOnce(new Error("db down"));

    await resetPassword(
      req({ token: "x", newPassword: "N3w!Passw0rd", confirmPassword: "N3w!Passw0rd" }),
      res,
    );

    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });
});
