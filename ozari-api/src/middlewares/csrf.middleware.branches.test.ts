import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { generateCsrfToken, verifyCsrfToken } from "./csrf.middleware.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((k: string) => k) } }));

const makeRes = (): Response =>
  ({
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;

describe("csrf — remaining branches", () => {
  const originalSecret = process.env["JWT_SECRET"];
  afterEach(() => {
    if (originalSecret !== undefined) process.env["JWT_SECRET"] = originalSecret;
    else delete process.env["JWT_SECRET"];
    vi.clearAllMocks();
  });

  it("throws when JWT_SECRET is not configured", () => {
    delete process.env["JWT_SECRET"];
    expect(() => generateCsrfToken()).toThrow(/JWT_SECRET/);
  });

  it("rejects a token whose signature length differs (constant-time length-mismatch path)", () => {
    process.env["JWT_SECRET"] = "test-secret-0123456789-abcdefghijklmno";
    const req = {
      method: "POST",
      originalUrl: "/api/x",
      headers: { "x-csrf-token": "somenonce.abc" }, // valid nonce, but a too-short signature
    } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    verifyCsrfToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    expect(next).not.toHaveBeenCalled();
  });
});
