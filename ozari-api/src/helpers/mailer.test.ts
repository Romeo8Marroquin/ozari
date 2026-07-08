import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the Resend SDK: capture the constructor (API key) and the emails.send call. A REGULAR
// function (not an arrow) is required because the code calls `new Resend(...)`.
const { sendMock, resendCtor } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const resendCtor = vi.fn(function ResendMock() {
    return { emails: { send: sendMock } };
  });
  return { sendMock, resendCtor };
});
vi.mock("resend", () => ({ Resend: resendCtor }));

describe("Mailer", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalEmailKey = process.env["EMAIL_KEY"];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Selection keys off EMAIL_KEY, so keep it absent unless a test opts in.
    delete process.env["EMAIL_KEY"];
    sendMock.mockResolvedValue({ data: { id: "1" }, error: null });
  });

  afterEach(() => {
    if (originalNodeEnv) {
      process.env["NODE_ENV"] = originalNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
    if (originalEmailKey === undefined) {
      delete process.env["EMAIL_KEY"];
    } else {
      process.env["EMAIL_KEY"] = originalEmailKey;
    }
  });

  it("uses the log mailer in development", async () => {
    process.env["NODE_ENV"] = "development";
    const { getMailer } = await import("./mailer.js");
    const { logger } = await import("@/config/logger.js");

    await getMailer().send({ to: "user@example.com", subject: "s", text: "link" });

    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(resendCtor).not.toHaveBeenCalled();
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
    expect(resendCtor).not.toHaveBeenCalled();
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

  it("uses the Resend mailer whenever EMAIL_KEY is set — even when deployed", async () => {
    process.env["NODE_ENV"] = "staging";
    process.env["EMAIL_KEY"] = "re_test_key";
    const { getMailer } = await import("./mailer.js");

    await getMailer().send({
      to: "user@example.com",
      subject: "Hi",
      text: "body",
      html: "<p>hi</p>",
    });

    expect(resendCtor).toHaveBeenCalledWith("re_test_key");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: "Hi",
        text: "body",
        html: "<p>hi</p>",
      }),
    );
  });

  it("omits html for a text-only Resend message", async () => {
    process.env["EMAIL_KEY"] = "re_test_key";
    const { getMailer } = await import("./mailer.js");

    await getMailer().send({ to: "user@example.com", subject: "S", text: "T" });

    const payload = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload["html"]).toBeUndefined();
    expect(payload["text"]).toBe("T");
  });

  it("throws when Resend returns a delivery error", async () => {
    process.env["EMAIL_KEY"] = "re_test_key";
    sendMock.mockResolvedValue({ data: null, error: { message: "bad recipient", name: "x" } });
    const { getMailer } = await import("./mailer.js");

    await expect(
      getMailer().send({ to: "user@example.com", subject: "S", text: "T" }),
    ).rejects.toThrow("bad recipient");
  });

  it("sends from the configured default sender when the message has no `from`", async () => {
    process.env["EMAIL_KEY"] = "re_test_key";
    const { getMailer } = await import("./mailer.js");
    const { appConfig } = await import("@/config/app.js");

    await getMailer().send({ to: "user@example.com", subject: "S", text: "T" });

    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({ from: appConfig.email.from.default });
  });

  it("honors a per-message `from` override (e.g. a per-purpose sender)", async () => {
    process.env["EMAIL_KEY"] = "re_test_key";
    const { getMailer } = await import("./mailer.js");

    await getMailer().send({
      to: "user@example.com",
      subject: "S",
      text: "T",
      from: "Party Rentals <bienvenida@partyrentalsgt.com>",
    });

    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      from: "Party Rentals <bienvenida@partyrentalsgt.com>",
    });
  });
});
