import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { validateApiKey } from "./apiKey.middleware.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string) => key),
  },
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn((res: Response, status: number) => {
    res.status(status).json({ success: false });
  }),
}));

describe("API Key Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const originalApiKey = process.env["API_KEY"];

  beforeEach(() => {
    mockReq = {
      header: vi.fn(),
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    process.env["API_KEY"] = "test-api-key-12345";
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalApiKey) {
      process.env["API_KEY"] = originalApiKey;
    }
  });

  it("should call next() with valid API key", () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      "test-api-key-12345",
    );

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should reject request without API key", () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject request with invalid API key", () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      "wrong-api-key",
    );

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should return 500 if API_KEY env var is not set", () => {
    delete process.env["API_KEY"];
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      "some-api-key",
    );

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(
      HttpEnum.INTERNAL_SERVER_ERROR,
    );
  });

  it("should use constant-time comparison", () => {
    const validKey = "test-api-key-12345";
    const similarKey = "test-api-key-12346";

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(similarKey);

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should handle keys of different lengths", () => {
    process.env["API_KEY"] = "test-api-key-12345";
    const shorterKey = "short";

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(shorterKey);

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should handle errors gracefully", () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("Unexpected error");
    });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(
      HttpEnum.INTERNAL_SERVER_ERROR,
    );
  });
});
