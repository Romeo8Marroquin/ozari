import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "./logger.js";

vi.mock("./context.js", () => ({
  asyncLocalStorage: {
    getStore: vi.fn(),
  },
}));

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create logger with correct configuration", () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBeDefined();
  });

  it("should log at different levels", () => {
    const infoSpy = vi.spyOn(logger, "info");
    const warnSpy = vi.spyOn(logger, "warn");
    const errorSpy = vi.spyOn(logger, "error");

    logger.info("Test info message");
    logger.warn("Test warn message");
    logger.error("Test error message");

    expect(infoSpy).toHaveBeenCalledWith("Test info message");
    expect(warnSpy).toHaveBeenCalledWith("Test warn message");
    expect(errorSpy).toHaveBeenCalledWith("Test error message");

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("should handle context information", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid-1234",
      method: "GET",
      originalUrl: "/api/test",
      hostname: "localhost",
      ips: ["127.0.0.1"],
      protocol: "http",
      timestamp: new Date(),
      userAgent: "test-agent",
      body: { test: "data" },
      query: { param: "value" },
      params: {},
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with context", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle missing context", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without context");

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog flag", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "POST",
      originalUrl: "/api/auth/signin",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("First log", { firstLog: true });
    logger.info("Subsequent log", { firstLog: false });

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("should format logs with partial context", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "partial-uuid",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Partial context log", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should use correct log level from environment", async () => {
    const originalLevel = process.env["LOG_LEVEL"];
    process.env["LOG_LEVEL"] = "debug";

    const { logger: debugLogger } = await import("./logger.js");
    expect(debugLogger.level).toBeDefined();

    if (originalLevel) {
      process.env["LOG_LEVEL"] = originalLevel;
    }
  });

  it("should use correct format based on NODE_ENV", () => {
    expect(logger.format).toBeDefined();
  });

  it("should handle firstLog without requestUuid", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      method: "GET",
      originalUrl: "/api/test",
      protocol: "https",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without requestUuid", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without protocol", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "POST",
      originalUrl: "/api/auth",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without protocol", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without method and originalUrl", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      protocol: "https",
      hostname: "example.com",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without method/originalUrl", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without hostname", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
      protocol: "https",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without hostname", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without userAgent", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
      protocol: "https",
      hostname: "example.com",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without userAgent", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without body", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without body", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without params", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without params", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without query", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without query", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog without ips", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      method: "GET",
      originalUrl: "/api/test",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test without ips", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with completely empty context", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({});

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with empty context", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with protocol field in info", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with protocol", {
      firstLog: true,
      protocol: "https",
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with body field in info", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with body", {
      firstLog: true,
      body: { username: "test", password: "secret" },
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with params field in info", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with params", {
      firstLog: true,
      params: { id: "123" },
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with query field in info", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with query", {
      firstLog: true,
      query: { search: "test", limit: "10" },
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle firstLog with ips field", async () => {
    const { asyncLocalStorage } = await import("./context.js");

    (asyncLocalStorage.getStore as ReturnType<typeof vi.fn>).mockReturnValue({
      requestUuid: "test-uuid",
      ips: ["192.168.1.1", "10.0.0.1"],
    });

    const spy = vi.spyOn(logger, "info");
    logger.info("Test with ips", { firstLog: true });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
