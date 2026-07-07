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
