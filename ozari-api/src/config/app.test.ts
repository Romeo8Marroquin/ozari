import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `appConfig.cookieConfig` is evaluated once at module load from the environment, so we re-import the
 * module under each environment to cover both branches (deployed → cross-site secure cookies).
 */
describe("appConfig cookieConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses lax, non-secure cookies outside deployed environments", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { appConfig } = await import("./app.js");
    expect(appConfig.cookieConfig.sameSite).toBe("lax");
    expect(appConfig.cookieConfig.secure).toBe(false);
  });

  it("uses none, secure cookies in a deployed environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { appConfig } = await import("./app.js");
    expect(appConfig.cookieConfig.sameSite).toBe("none");
    expect(appConfig.cookieConfig.secure).toBe(true);
  });
});

/**
 * The email logo is DERIVED from the frontend origin rather than written down — the asset ships in
 * the frontend's `public/`, so it moves whenever the frontend does. Read through a getter, so it
 * follows `APP_HOST` at call time instead of freezing at module load.
 */
describe("appConfig email logoUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("points at the CURRENT frontend origin — no environment left behind", async () => {
    const { appConfig } = await import("./app.js");
    vi.stubEnv("APP_HOST", "https://staging.partyrentalsgt.com");
    expect(appConfig.email.logoUrl).toBe("https://staging.partyrentalsgt.com/email-logo.png");
    // The same process, a different origin: the getter follows it with no redeploy of this file.
    vi.stubEnv("APP_HOST", "https://partyrentalsgt.com");
    expect(appConfig.email.logoUrl).toBe("https://partyrentalsgt.com/email-logo.png");
  });

  it("falls back to the text wordmark when there is no frontend origin", async () => {
    const { appConfig } = await import("./app.js");
    vi.stubEnv("APP_HOST", "");
    // An empty string is the layout's documented opt-out — never a half-built `/email-logo.png`.
    expect(appConfig.email.logoUrl).toBe("");
  });
});
