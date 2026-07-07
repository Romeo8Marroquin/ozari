import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Response } from "express";
import {
  disableMfa,
  enableMfa,
  setupMfa,
  verifyMfaLogin,
} from "./auth.mfa.controller.js";
import {
  encryptKms,
  encryptSha256Sync,
  hashPassword,
} from "@helpers/encryption.js";
import {
  generateTotp,
  getTotpStep,
  generateTotpSecret,
} from "@helpers/totp.js";
import { appConfig } from "@/config/app.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { issueAuthenticatedSession } from "./auth.service.js";
import {
  clearMfaAttempts,
  recordFailedMfa,
} from "@middlewares/mfaRateLimit.middleware.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import type {
  CustomRequest,
  MfaTokenPayloadModel,
  UserJwtPayloadModel,
} from "@models/common/customRequestModel.js";

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: { t: vi.fn((key: string) => key) },
}));

vi.mock("@/config/auditLogger.js", () => ({
  logAuthAudit: vi.fn(),
  AuditAction: { MFA_ENABLED: "MFA_ENABLED", MFA_DISABLED: "MFA_DISABLED", USER_LOGIN_SUCCESS: "USER_LOGIN_SUCCESS" },
}));

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("./auth.service.js", () => ({
  issueAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@middlewares/mfaRateLimit.middleware.js", () => ({
  recordFailedMfa: vi.fn(),
  clearMfaAttempts: vi.fn(),
}));

vi.mock("@models/http/ozariSuccessModel.js", () => ({
  sendOzariSuccess: vi.fn(),
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn(),
}));

const SECRET = generateTotpSecret();
const res = {} as Response;

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    roleId: RolesEnum.Client,
    emailKms: encryptKms("user@example.com"),
    passwordSha: "",
    mfaSecretKms: encryptKms(SECRET),
    mfaEnabledAt: null,
    mfaLastUsedAt: null,
    ...overrides,
  };
}

function mockPrisma(user: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const client = {
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue(user),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mfaRecoveryCode: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn().mockResolvedValue([]),
    ...extra,
  };
  (getPrismaClient as Mock).mockResolvedValue(client);
  return client;
}

const authedReq = (body: unknown): CustomRequest =>
  ({
    body,
    headers: {},
    user: {
      userId: 1,
      deviceUuid: "device-1",
      userRole: RolesEnum.Client,
    } as UserJwtPayloadModel,
  }) as unknown as CustomRequest;

const mfaReq = (body: unknown): CustomRequest =>
  ({
    body,
    headers: {},
    mfaToken: {
      userId: 1,
      deviceUuid: "device-1",
      tokenType: TokenEnum.MFA_TOKEN,
      iat: 0,
    } as MfaTokenPayloadModel,
  }) as unknown as CustomRequest;

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setupMfa", () => {
  it("rejects when MFA is already enabled", async () => {
    mockPrisma(buildUser({ mfaEnabledAt: new Date() }));
    await setupMfa(authedReq({}), res);
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.CONFLICT,
      expect.any(String),
    );
  });

  it("stores an encrypted secret and returns the otpauth uri", async () => {
    const client = mockPrisma(buildUser({ mfaSecretKms: null }));
    await setupMfa(authedReq({}), res);
    expect(client.user.update).toHaveBeenCalled();
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3];
    expect(data.secret).toBeDefined();
    expect(data.otpauthUri).toContain("otpauth://totp/");
  });
});

describe("enableMfa", () => {
  it("rejects an invalid code", async () => {
    mockPrisma(buildUser());
    await enableMfa(authedReq({ code: "invalid" }), res);
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      expect.any(String),
    );
  });

  it("enables MFA and returns recovery codes for a valid code", async () => {
    const client = mockPrisma(buildUser());
    const code = generateTotp(SECRET);
    await enableMfa(authedReq({ code }), res);
    expect(client.$transaction).toHaveBeenCalled();
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3];
    expect(data.recoveryCodes).toHaveLength(appConfig.mfa.recoveryCodeCount);
  });
});

describe("verifyMfaLogin", () => {
  it("issues a session for a valid TOTP code", async () => {
    mockPrisma(buildUser({ mfaEnabledAt: new Date(), mfaLastUsedAt: null }));
    const code = generateTotp(SECRET);
    await verifyMfaLogin(mfaReq({ code }), res);
    expect(issueAuthenticatedSession).toHaveBeenCalledWith(
      expect.anything(),
      res,
      expect.objectContaining({ userId: 1, deviceUuid: "device-1" }),
    );
    expect(clearMfaAttempts).toHaveBeenCalledWith(1);
  });

  it("rejects a replayed TOTP code (step already consumed)", async () => {
    const currentStep = getTotpStep(Date.now());
    mockPrisma(
      buildUser({
        mfaEnabledAt: new Date(),
        mfaLastUsedAt: new Date(currentStep * appConfig.mfa.totpStepSeconds * 1000),
      }),
    );
    const code = generateTotp(SECRET, currentStep);
    await verifyMfaLogin(mfaReq({ code }), res);
    expect(issueAuthenticatedSession).not.toHaveBeenCalled();
    expect(recordFailedMfa).toHaveBeenCalledWith(1);
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      expect.any(String),
    );
  });

  it("consumes a valid recovery code and issues a session", async () => {
    const recoveryCode = "ABCD2345EFGH6789";
    const client = mockPrisma(
      buildUser({ mfaEnabledAt: new Date() }),
      {
        mfaRecoveryCode: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 7, codeSha: encryptSha256Sync(recoveryCode) }),
          update: vi.fn().mockResolvedValue(undefined),
        },
      },
    );
    await verifyMfaLogin(mfaReq({ code: recoveryCode }), res);
    expect(client.mfaRecoveryCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
    );
    expect(issueAuthenticatedSession).toHaveBeenCalled();
  });

  it("rejects an unknown recovery code", async () => {
    mockPrisma(buildUser({ mfaEnabledAt: new Date() }));
    await verifyMfaLogin(mfaReq({ code: "ZZZZ2345ZZZZ6789" }), res);
    expect(issueAuthenticatedSession).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      expect.any(String),
    );
  });
});

describe("disableMfa", () => {
  it("rejects an invalid password", async () => {
    const passwordSha = await hashPassword("CorrectPass123!");
    mockPrisma(buildUser({ mfaEnabledAt: new Date(), passwordSha }));
    await disableMfa(authedReq({ password: "WrongPass123!" }), res);
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      expect.any(String),
    );
  });

  it("disables MFA with the correct password", async () => {
    const passwordSha = await hashPassword("CorrectPass123!");
    const client = mockPrisma(buildUser({ mfaEnabledAt: new Date(), passwordSha }));
    await disableMfa(authedReq({ password: "CorrectPass123!" }), res);
    expect(client.$transaction).toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });
});
