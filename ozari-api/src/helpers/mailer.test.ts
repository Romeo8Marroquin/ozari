import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Mailer", () => {
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalNodeEnv) {
      process.env["NODE_ENV"] = originalNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
  });

  it("uses the log mailer in development", async () => {
    process.env["NODE_ENV"] = "development";
    const { getMailer } = await import("./mailer.js");
    const { logger } = await import("@/config/logger.js");

    await getMailer().send({ to: "user@example.com", subject: "s", text: "link" });

    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("uses the noop mailer in deployed environments without leaking content", async () => {
    process.env["NODE_ENV"] = "production";
    const { getMailer } = await import("./mailer.js");
    const { logger } = await import("@/config/logger.js");

    await getMailer().send({
      to: "user@example.com",
      subject: "s",
      text: "secret-link",
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    const loggedArgs = JSON.stringify(
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(loggedArgs).not.toContain("secret-link");
    expect(loggedArgs).not.toContain("user@example.com");
  });

  it("returns a cached singleton", async () => {
    process.env["NODE_ENV"] = "development";
    const { getMailer } = await import("./mailer.js");
    expect(getMailer()).toBe(getMailer());
  });
});
