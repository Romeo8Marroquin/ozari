import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import type { Express } from "express";

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn().mockResolvedValue({}),
  disconnectPrisma: vi.fn().mockResolvedValue(undefined),
}));

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
    handle: vi
      .fn()
      .mockReturnValue((_req: unknown, _res: unknown, next: () => void) =>
        next(),
      ),
  },
}));

vi.mock("@/config/context.js", () => ({
  asyncLocalStorage: {
    run: vi.fn((_store: unknown, callback: () => void) => callback()),
    getStore: vi.fn().mockReturnValue({}),
  },
}));

const API_KEY = "test-api-key-protected";

describe("Protected auth routes (gating)", () => {
  let app: Express;

  beforeAll(() => {
    process.env["API_KEY"] = API_KEY;
    process.env["APP_HOST"] = "http://localhost:5173";
    process.env["JWT_SECRET"] = "test-jwt-secret-key-for-integration";
    process.env["JWT_REFRESH_SECRET"] = "test-jwt-refresh-secret-integration";
    process.env["ENCRYPTION_KEY"] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    app = createApp();
  });

  it("rejects GET /me without an access token", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("x-api-key", API_KEY);

    expect(response.status).toBe(401);
  });

  it("rejects POST /change-password without an access token", async () => {
    const response = await request(app)
      .post("/api/auth/change-password")
      .set("x-api-key", API_KEY)
      .send({
        currentPassword: "OldSecurePass123!",
        newPassword: "NewSecurePass123!",
        confirmPassword: "NewSecurePass123!",
      });

    expect(response.status).toBe(401);
  });

  it("rejects POST /mfa/setup without an access token", async () => {
    const response = await request(app)
      .post("/api/auth/mfa/setup")
      .set("x-api-key", API_KEY);

    expect(response.status).toBe(401);
  });

  it("rejects POST /mfa/verify-login without an MFA token", async () => {
    const response = await request(app)
      .post("/api/auth/mfa/verify-login")
      .set("x-api-key", API_KEY)
      .send({ code: "123456" });

    expect(response.status).toBe(401);
  });

  it("rejects POST /mfa/verify-login with a malformed bearer token", async () => {
    const response = await request(app)
      .post("/api/auth/mfa/verify-login")
      .set("x-api-key", API_KEY)
      .set("Authorization", "Bearer not-a-jwt")
      .send({ code: "123456" });

    expect(response.status).toBe(401);
  });

  it("rejects POST /signout without a CSRF token", async () => {
    const response = await request(app)
      .post("/api/auth/signout")
      .set("x-api-key", API_KEY);

    expect(response.status).toBe(403);
  });
});
