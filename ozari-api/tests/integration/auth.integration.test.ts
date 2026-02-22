import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import type { Express } from "express";
import crypto from "node:crypto";

const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  jwtSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  blacklist: {
    findFirst: vi.fn(),
  },
  $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
};

vi.mock("@/services/prisma.service.js", () => {
  return {
    getPrismaClient: vi.fn().mockImplementation(() =>
      Promise.resolve({
        user: {
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        jwtSession: {
          create: vi.fn(),
          findFirst: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
        blacklist: {
          findFirst: vi.fn(),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      }),
    ),
    disconnectPrisma: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string) => key),
    init: vi.fn().mockResolvedValue(undefined),
    use: vi.fn().mockReturnThis(),
  },
  i18nmiddleware: {
    handle: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  },
}));

vi.mock("@/config/context.js", () => ({
  asyncLocalStorage: {
    run: vi.fn((store: unknown, callback: () => void) => callback()),
    getStore: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("@/middlewares/loginRateLimit.middleware.js", () => ({
  checkLoginRateLimit: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  recordFailedLogin: vi.fn(),
  clearLoginAttempts: vi.fn(),
}));

vi.mock("@/config/auditLogger.js", () => ({
  logAuthAudit: vi.fn(),
  AuditAction: {
    USER_CREATED: "USER_CREATED",
    USER_LOGIN_SUCCESS: "USER_LOGIN_SUCCESS",
    USER_LOGIN_FAILED: "USER_LOGIN_FAILED",
    USER_LOGOUT: "USER_LOGOUT",
    TOKEN_REFRESH: "TOKEN_REFRESH",
  },
}));

describe("Auth Endpoints", () => {
  let app: Express;

  beforeAll(() => {
    process.env["API_KEY"] = "test-api-key-integration";
    process.env["APP_HOST"] = "http://localhost:5173";
    process.env["JWT_SECRET"] = "test-jwt-secret-key-for-integration";
    process.env["JWT_REFRESH_SECRET"] =
      "test-jwt-refresh-secret-key-for-integration";
    process.env["ENCRYPTION_KEY"] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    app = createApp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/signup", () => {
    it("should return 401 without API key", async () => {
      const response = await request(app).post("/api/auth/signup").send({
        fullName: "John Doe",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "SecurePass123!",
        termsAccepted: true,
      });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/auth/signin", () => {
    it("should return 401 without API key", async () => {
      const response = await request(app)
        .post("/api/auth/signin")
        .set("device-uuid", crypto.randomUUID())
        .send({
          email: "john@example.com",
          password: "SecurePass123!",
        });

      expect(response.status).toBe(401);
    });

    it("should validate request format", async () => {
      const response = await request(app)
        .post("/api/auth/signin")
        .set("x-api-key", "test-api-key-integration")
        .set("device-uuid", crypto.randomUUID())
        .send({
          email: "invalid-email",
          password: "SecurePass123!",
        });

      expect(response.status).toBe(400);
    });

    it("should require device UUID header", async () => {
      const response = await request(app)
        .post("/api/auth/signin")
        .set("x-api-key", "test-api-key-integration")
        .send({
          email: "john@example.com",
          password: "SecurePass123!",
        });

      expect(response.status).toBe(400);
    });
  });

  describe("Rate Limiting", () => {
    it("should apply rate limiting to auth endpoints", async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const deviceUuid = crypto.randomUUID();
      const requests = Array(12)
        .fill(null)
        .map(() =>
          request(app)
            .post("/api/auth/signin")
            .set("x-api-key", "test-api-key-integration")
            .set("device-uuid", deviceUuid)
            .send({
              email: "test@example.com",
              password: "SecurePass123!",
            }),
        );

      const responses = await Promise.all(requests);
      const tooManyRequests = responses.filter((r) => r.status === 429);

      expect(tooManyRequests.length).toBeGreaterThan(0);
    });
  });
});
