import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  changePassword,
  createUser,
  getAllUsers,
  getMe,
  refreshToken,
  signInUser,
  signOutUser,
} from "./auth.controller.js";
import { appConfig } from "@/config/app.js";
import {
  encryptKms,
  encryptSha256Sync,
  hashPassword,
} from "@helpers/encryption.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { issueAuthenticatedSession } from "./auth.service.js";
import {
  clearLoginAttempts,
  recordFailedLogin,
} from "@middlewares/loginRateLimit.middleware.js";
import { setCsrfToken } from "@middlewares/csrf.middleware.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import type {
  CustomRequest,
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
  logSecurityAudit: vi.fn(),
  logUserManagementAudit: vi.fn(),
  AuditAction: new Proxy({}, { get: (_t, prop) => prop }),
}));

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("./auth.service.js", () => ({
  issueAuthenticatedSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@middlewares/loginRateLimit.middleware.js", () => ({
  recordFailedLogin: vi.fn(),
  clearLoginAttempts: vi.fn(),
}));

vi.mock("@middlewares/csrf.middleware.js", () => ({
  setCsrfToken: vi.fn(),
}));

// Isolate the welcome-email side effect of registration (its internals live in mailer.test /
// welcomeEmail.test). The spy lets us assert it's attempted and simulate a delivery failure.
const { welcomeMailerSend } = vi.hoisted(() => ({ welcomeMailerSend: vi.fn() }));
vi.mock("@helpers/mailer.js", () => ({ getMailer: () => ({ send: welcomeMailerSend }) }));
vi.mock("../../emails/welcomeEmail.js", () => ({
  buildWelcomeEmail: vi.fn(() => ({ to: "new@example.com", subject: "welcome", text: "hi" })),
}));

vi.mock("@models/http/ozariSuccessModel.js", () => ({
  sendOzariSuccess: vi.fn(),
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn(),
}));

// --- helpers -------------------------------------------------------------

function buildRes(): Response {
  const res = {} as Response;
  res.header = vi.fn().mockReturnValue(res);
  res.cookie = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res;
}

interface PrismaOpts {
  user?: Record<string, unknown> | null;
  userFindUnique?: Record<string, unknown> | null;
  userFindMany?: Record<string, unknown>[];
  currentRefresh?: Record<string, unknown> | null;
  lockedRows?: Array<{ jti: string }>;
}

function mockPrisma(opts: PrismaOpts = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(opts.lockedRows ?? []),
    jwtSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    user: { update: vi.fn().mockResolvedValue(opts.user ?? null) },
  };
  const client = {
    user: {
      findFirst: vi.fn().mockResolvedValue(opts.user ?? null),
      findUnique: vi.fn().mockResolvedValue(opts.userFindUnique ?? null),
      findMany: vi.fn().mockResolvedValue(opts.userFindMany ?? []),
      create: vi.fn().mockResolvedValue(opts.user ?? { id: 1 }),
      update: vi.fn().mockResolvedValue(opts.user ?? null),
    },
    jwtSession: {
      findFirst: vi.fn().mockResolvedValue(opts.currentRefresh ?? null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };
  (getPrismaClient as Mock).mockResolvedValue(client);
  return { client, tx };
}

const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

function makeRefreshToken(
  overrides: Record<string, unknown> = {},
  secret = process.env["JWT_REFRESH_SECRET"]!,
): string {
  return jwt.sign(
    {
      jti: "jti-current",
      deviceUuid: "device-1",
      userId: 1,
      userRole: RolesEnum.Client,
      tokenType: TokenEnum.REFRESH_TOKEN,
      ...overrides,
    },
    secret,
    appConfig.refreshToken as jwt.SignOptions,
  );
}

const refreshReq = (token?: string): Request =>
  ({
    cookies: token ? { "refresh-token": token } : {},
    headers: {},
    ip: "127.0.0.1",
    query: {},
  }) as unknown as Request;

const authedReq = (
  body: unknown,
  user: Partial<UserJwtPayloadModel> = {},
): CustomRequest =>
  ({
    body,
    headers: {},
    ip: "127.0.0.1",
    query: {},
    user: {
      userId: 1,
      deviceUuid: "device-1",
      userRole: RolesEnum.Client,
      ...user,
    } as UserJwtPayloadModel,
  }) as unknown as CustomRequest;

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    roleId: RolesEnum.Client,
    emailKms: encryptKms("user@example.com"),
    fullNameKms: encryptKms("Test User"),
    passwordSha: "",
    mfaSecretKms: null,
    mfaEnabledAt: null,
    mfaLastUsedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: null,
    ...overrides,
  };
}

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env["JWT_SECRET"] = "test-jwt-secret-0123456789-abcdefghij";
  process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret-0123456789-abcde";
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --- createUser ----------------------------------------------------------

describe("createUser", () => {
  const body = {
    email: "new@example.com",
    fullName: "New User",
    password: "StrongPass1!",
    confirmPassword: "StrongPass1!",
    termsAccepted: true,
  };

  it("rejects a duplicate email with 409", async () => {
    mockPrisma({ userFindUnique: { id: 1 } });
    await createUser(authedReq(body), buildRes());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      expect.any(String),
    );
  });

  it("creates a new user as a Client (never admin) and returns 201", async () => {
    const { client } = mockPrisma({ userFindUnique: null });
    await createUser(authedReq(body), buildRes());

    const createArg = (client.user.create as Mock).mock.calls[0]?.[0];
    expect(createArg.data.roleId).toBe(RolesEnum.Client);
    expect(createArg.data.termsAccepted).toBe(true);
    // PII is stored encrypted, not in plaintext.
    expect(createArg.data.emailKms).not.toBe(body.email);
    expect(createArg.data.passwordSha).not.toBe(body.password);
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      expect.any(String),
    );
    // A welcome email is sent on successful registration.
    expect(welcomeMailerSend).toHaveBeenCalledTimes(1);
  });

  it("still returns 201 when the welcome email fails (best-effort, non-fatal)", async () => {
    mockPrisma({ userFindUnique: null });
    welcomeMailerSend.mockRejectedValueOnce(new Error("smtp down"));

    await createUser(authedReq(body), buildRes());

    // Registration succeeds regardless — the account was already created.
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      expect.any(String),
    );
  });
});

// --- signInUser ----------------------------------------------------------

describe("signInUser", () => {
  const body = {
    email: "user@example.com",
    password: "StrongPass1!",
    deviceUuid: "device-1",
  };

  it("returns 401 and records a failed attempt for an unknown user", async () => {
    mockPrisma({ user: null });
    await signInUser(authedReq(body) as Request, buildRes());
    expect(recordFailedLogin).toHaveBeenCalledWith(body.email);
    expect(issueAuthenticatedSession).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("returns 401 for a wrong password", async () => {
    const passwordSha = await hashPassword("CorrectPass1!");
    mockPrisma({ user: buildUser({ passwordSha }) });
    await signInUser(authedReq(body) as Request, buildRes());
    expect(recordFailedLogin).toHaveBeenCalledWith(body.email);
    expect(issueAuthenticatedSession).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("issues a session on a correct password (no MFA)", async () => {
    const passwordSha = await hashPassword(body.password);
    mockPrisma({ user: buildUser({ passwordSha }) });
    await signInUser(authedReq(body) as Request, buildRes());
    expect(issueAuthenticatedSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: 1, deviceUuid: "device-1" }),
    );
    expect(clearLoginAttempts).toHaveBeenCalledWith(body.email);
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("returns an mfaToken (and no session) when MFA is enabled", async () => {
    const passwordSha = await hashPassword(body.password);
    mockPrisma({ user: buildUser({ passwordSha, mfaEnabledAt: new Date() }) });
    await signInUser(authedReq(body) as Request, buildRes());

    expect(issueAuthenticatedSession).not.toHaveBeenCalled();
    const successData = (sendOzariSuccess as Mock).mock.calls[0]?.[3];
    expect(successData.mfaRequired).toBe(true);
    // The mfaToken is a short-lived MFA challenge JWT signed with JWT_SECRET.
    const decoded = jwt.verify(
      successData.mfaToken,
      process.env["JWT_SECRET"]!,
      {
        algorithms: [appConfig.mfaToken.algorithm],
        audience: appConfig.mfaToken.audience,
        issuer: appConfig.mfaToken.issuer,
      },
    ) as jwt.JwtPayload & { tokenType: number };
    expect(decoded.tokenType).toBe(TokenEnum.MFA_TOKEN);
  });
});

// --- refreshToken --------------------------------------------------------

describe("refreshToken", () => {
  it("returns 401 when no refresh cookie is present", async () => {
    mockPrisma();
    await refreshToken(refreshReq(), buildRes());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("returns 401 for a non-refresh token type", async () => {
    mockPrisma();
    const token = makeRefreshToken({ tokenType: TokenEnum.ACCESS_TOKEN });
    await refreshToken(refreshReq(token), buildRes());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("returns 401 when the device has no active session", async () => {
    mockPrisma({ currentRefresh: null });
    await refreshToken(refreshReq(makeRefreshToken()), buildRes());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("detects reuse of a rotated token and invalidates ALL user sessions", async () => {
    const { client, tx } = mockPrisma({
      currentRefresh: {
        jti: "jti-newer",
        expiresAt: FUTURE,
        deviceUuid: "device-1",
        userId: 1,
      },
    });
    // Token carries the OLD jti, but the device's current jti is different.
    await refreshToken(refreshReq(makeRefreshToken({ jti: "jti-old" })), buildRes());

    expect(client.jwtSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 1 },
    });
    expect(tx.jwtSession.createMany).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("returns 401 when the session row is expired", async () => {
    const { client } = mockPrisma({
      currentRefresh: {
        jti: "jti-current",
        expiresAt: PAST,
        deviceUuid: "device-1",
        userId: 1,
      },
    });
    await refreshToken(refreshReq(makeRefreshToken()), buildRes());
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });

  it("rotates tokens on the happy path", async () => {
    const { tx } = mockPrisma({
      currentRefresh: {
        jti: "jti-current",
        expiresAt: FUTURE,
        deviceUuid: "device-1",
        userId: 1,
      },
      lockedRows: [{ jti: "jti-current" }],
    });
    const res = buildRes();
    await refreshToken(refreshReq(makeRefreshToken()), res);

    expect(tx.jwtSession.deleteMany).toHaveBeenCalled();
    const created = (tx.jwtSession.createMany as Mock).mock.calls[0]?.[0]
      .data as Array<{ tokenTypeId: number }>;
    expect(created).toHaveLength(2);
    expect(res.header).toHaveBeenCalledWith(
      "authorization",
      expect.stringMatching(/^Bearer .+/),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "refresh-token",
      expect.any(String),
      expect.anything(),
    );
    expect(setCsrfToken).toHaveBeenCalledWith(res);
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      res,
      HttpEnum.OK,
      expect.any(String),
    );
  });

  it("treats a concurrent rotation of the same token as a retry (401, no theft)", async () => {
    const { client, tx } = mockPrisma({
      currentRefresh: {
        jti: "jti-current",
        expiresAt: FUTURE,
        deviceUuid: "device-1",
        userId: 1,
      },
      // The locked row changed between the pre-check and the lock: a concurrent
      // refresh of the same token already rotated it.
      lockedRows: [{ jti: "jti-rotated-by-the-other-request" }],
    });
    await refreshToken(refreshReq(makeRefreshToken()), buildRes());

    expect(tx.jwtSession.createMany).not.toHaveBeenCalled();
    // NOT theft: it must not nuke all the user's sessions.
    expect(client.jwtSession.deleteMany).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNAUTHORIZED,
      expect.any(String),
    );
  });
});

// --- signOutUser ---------------------------------------------------------

describe("signOutUser", () => {
  it("clears the device session and credentials with a valid refresh cookie", async () => {
    const { client } = mockPrisma();
    const res = buildRes();
    await signOutUser(refreshReq(makeRefreshToken()) as CustomRequest, res);

    expect(client.jwtSession.deleteMany).toHaveBeenCalledWith({
      where: { deviceUuid: "device-1", isActive: true, userId: 1 },
    });
    expect(res.clearCookie).toHaveBeenCalledWith(
      "refresh-token",
      expect.anything(),
    );
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("signs out all devices when allDevices=true", async () => {
    const { client } = mockPrisma();
    const req = refreshReq(makeRefreshToken()) as unknown as Record<
      string,
      unknown
    >;
    req["query"] = { allDevices: "true" };
    await signOutUser(req as unknown as CustomRequest, buildRes());
    expect(client.jwtSession.deleteMany).toHaveBeenCalledWith({
      where: { isActive: true, userId: 1 },
    });
  });

  it("is idempotent: succeeds and clears cookies even without a valid token", async () => {
    const { client } = mockPrisma();
    const res = buildRes();
    await signOutUser(refreshReq() as CustomRequest, res);
    expect(client.jwtSession.deleteMany).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });
});

// --- changePassword ------------------------------------------------------

describe("changePassword", () => {
  it("rejects an incorrect current password with 422", async () => {
    const passwordSha = await hashPassword("CurrentPass1!");
    mockPrisma({ user: buildUser({ passwordSha }) });
    await changePassword(
      authedReq({ currentPassword: "WrongPass1!", newPassword: "NewPass1!" }),
      buildRes(),
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNPROCESSABLE_ENTITY,
      expect.any(String),
    );
  });

  it("rejects reusing the same password with 400", async () => {
    const passwordSha = await hashPassword("CurrentPass1!");
    mockPrisma({ user: buildUser({ passwordSha }) });
    await changePassword(
      authedReq({
        currentPassword: "CurrentPass1!",
        newPassword: "CurrentPass1!",
      }),
      buildRes(),
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      expect.any(String),
    );
  });

  it("changes the password and revokes other devices", async () => {
    const passwordSha = await hashPassword("CurrentPass1!");
    const { client } = mockPrisma({ user: buildUser({ passwordSha }) });
    await changePassword(
      authedReq({
        currentPassword: "CurrentPass1!",
        newPassword: "BrandNewPass1!",
      }),
      buildRes(),
    );
    expect(client.$transaction).toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      expect.any(String),
    );
  });
});

// --- getMe ---------------------------------------------------------------

describe("getMe", () => {
  it("returns the decrypted profile with role and mfa flag", async () => {
    mockPrisma({ user: buildUser({ mfaEnabledAt: new Date() }) });
    await getMe(authedReq({}), buildRes());
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3];
    expect(data.email).toBe("user@example.com");
    expect(data.fullName).toBe("Test User");
    expect(data.role).toBe(RolesEnum[RolesEnum.Client]);
    expect(data.mfaEnabled).toBe(true);
  });

  it("returns 404 when the user no longer exists", async () => {
    mockPrisma({ user: null });
    await getMe(authedReq({}), buildRes());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      expect.any(String),
    );
  });
});

// --- getAllUsers ---------------------------------------------------------

describe("getAllUsers", () => {
  it("returns the decrypted list of active users", async () => {
    mockPrisma({ userFindMany: [buildUser()] });
    await getAllUsers({} as Request, buildRes());
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as Array<{
      email: string;
      role: string;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0]?.email).toBe("user@example.com");
    expect(data[0]?.role).toBe(RolesEnum[RolesEnum.Client]);
  });
});
