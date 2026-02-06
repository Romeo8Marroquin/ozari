import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import type { Express } from "express";

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn().mockResolvedValue({
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  }),
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
    handle: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  },
}));

vi.mock("@/config/context.js", () => ({
  asyncLocalStorage: {
    run: vi.fn((store: unknown, callback: () => void) => callback()),
    getStore: vi.fn().mockReturnValue({}),
  },
}));

describe("Health Check Endpoint", () => {
  let app: Express;

  beforeAll(() => {
    process.env["API_KEY"] = "test-api-key-integration";
    process.env["APP_HOST"] = "http://localhost:5173";
    app = createApp();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/health/check", () => {
    it("should return 401 without API key", async () => {
      const response = await request(app).get("/api/health/check");

      expect(response.status).toBe(401);
    });

    it("should return 200 with valid API key", async () => {
      const response = await request(app)
        .get("/api/health/check")
        .set("x-api-key", "test-api-key-integration");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("data");
    });

    it("should validate API key correctly", async () => {
      const response = await request(app)
        .get("/api/health/check")
        .set("x-api-key", "wrong-api-key");

      expect(response.status).toBe(401);
    });
  });
});
