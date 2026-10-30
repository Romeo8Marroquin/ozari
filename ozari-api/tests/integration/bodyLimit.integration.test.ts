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
    handle: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  },
}));

vi.mock("@/config/context.js", () => ({
  asyncLocalStorage: {
    run: vi.fn((store: unknown, callback: () => void) => callback()),
    getStore: vi.fn().mockReturnValue({}),
  },
}));

/** A JSON body of roughly `kb` kilobytes. */
const bodyOf = (kb: number) => ({ padding: "x".repeat(kb * 1024) });

/**
 * The body-size policy (AUTH-AND-SECURITY.md): 10kb everywhere, except the product full-state
 * create/update (POST /products, PUT /products/:id) at 32kb. A body the parser accepts reaches the
 * API-key gate (401 without a key); one it refuses never does (413).
 */
describe("JSON body limits", () => {
  let app: Express;

  beforeAll(() => {
    process.env["API_KEY"] = "test-api-key-integration";
    process.env["APP_HOST"] = "http://localhost:5173";
    app = createApp();
  });

  it("parses a 20kb product create (reaches the API-key gate)", async () => {
    const response = await request(app).post("/api/products").send(bodyOf(20));
    expect(response.status).toBe(401);
  });

  it("parses a 20kb product update (reaches the API-key gate)", async () => {
    const response = await request(app).put("/api/products/12").send(bodyOf(20));
    expect(response.status).toBe(401);
  });

  it("refuses a product write above 32kb", async () => {
    const response = await request(app).post("/api/products").send(bodyOf(40));
    expect(response.status).toBe(413);
  });

  it("keeps 10kb on every other route — even under /products", async () => {
    const orders = await request(app).post("/api/orders").send(bodyOf(20));
    expect(orders.status).toBe(413);
    const arrangement = await request(app).put("/api/products/display-order").send(bodyOf(20));
    expect(arrangement.status).toBe(413);
    const uploads = await request(app).post("/api/products/images/upload-url").send(bodyOf(20));
    expect(uploads.status).toBe(413);
  });
});
