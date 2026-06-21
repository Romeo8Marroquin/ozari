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
  const originalNodeEnv = process.env["NODE_ENV"];

  const setHeaders = (headers: Record<string, string | undefined>) => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string) => headers[name.toLowerCase()],
    );
  };

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
    process.env["APP_HOST"] = "http://localhost:5173";
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalApiKey) {
      process.env["API_KEY"] = originalApiKey;
    }
    if (originalNodeEnv) {
      process.env["NODE_ENV"] = originalNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
  });

  it("should call next() with valid API key", () => {
    setHeaders({ "x-api-key": "test-api-key-12345" });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should reject request without API key", () => {
    setHeaders({});

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject request with invalid API key", () => {
    setHeaders({ "x-api-key": "wrong-api-key" });

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
    setHeaders({ "x-api-key": "some-api-key" });

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
    const similarKey = "test-api-key-12346";

    setHeaders({ "x-api-key": similarKey });

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

    setHeaders({ "x-api-key": shorterKey });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should skip API key validation for browser-origin requests", () => {
    setHeaders({ origin: "http://localhost:5173" });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should allow production browser requests with fetch metadata", () => {
    process.env["NODE_ENV"] = "production";
    setHeaders({
      origin: "http://localhost:5173",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
    });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should reject production browser-origin requests without fetch metadata", () => {
    process.env["NODE_ENV"] = "production";
    setHeaders({ origin: "http://localhost:5173" });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
  });

  it("should reject untrusted browser origins even with an API key", () => {
    setHeaders({
      origin: "https://evil.example",
      "x-api-key": "test-api-key-12345",
    });

    validateApiKey(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
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
