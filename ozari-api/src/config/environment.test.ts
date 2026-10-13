import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAppHost,
  getNodeEnv,
  isDeployedEnvironment,
  isProductionEnvironment,
  isRegistrationOpen,
  isStagingEnvironment,
} from "./environment.js";

afterEach(() => vi.unstubAllEnvs());

describe("environment helpers", () => {
  it("getNodeEnv returns NODE_ENV, defaulting to development when unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getNodeEnv()).toBe("production");

    const original = process.env["NODE_ENV"];
    delete process.env["NODE_ENV"];
    expect(getNodeEnv()).toBe("development");
    process.env["NODE_ENV"] = original;
  });

  it("classifies production / staging / deployed", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionEnvironment()).toBe(true);
    expect(isStagingEnvironment()).toBe(false);
    expect(isDeployedEnvironment()).toBe(true);

    vi.stubEnv("NODE_ENV", "staging");
    expect(isStagingEnvironment()).toBe(true);
    expect(isDeployedEnvironment()).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(isDeployedEnvironment()).toBe(false);
  });

  it("getAppHost strips trailing slashes and defaults to empty", () => {
    vi.stubEnv("APP_HOST", "https://app.example.com///");
    expect(getAppHost()).toBe("https://app.example.com");

    const original = process.env["APP_HOST"];
    delete process.env["APP_HOST"];
    expect(getAppHost()).toBe("");
    if (original !== undefined) process.env["APP_HOST"] = original;
  });

  it("isRegistrationOpen fails CLOSED in deployed environments: only the exact string opens it", () => {
    for (const env of ["staging", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      vi.stubEnv("REGISTRATION_OPEN", "true");
      expect(isRegistrationOpen()).toBe(true);
      // A typo, a different casing or an absent variable must never let strangers register.
      for (const value of ["false", "TRUE", "1", "yes", ""]) {
        vi.stubEnv("REGISTRATION_OPEN", value);
        expect(isRegistrationOpen()).toBe(false);
      }
      vi.stubEnv("REGISTRATION_OPEN", undefined);
      expect(isRegistrationOpen()).toBe(false);
    }
  });

  it("isRegistrationOpen stays OPEN locally unless explicitly switched off", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REGISTRATION_OPEN", undefined);
    expect(isRegistrationOpen()).toBe(true);
    vi.stubEnv("REGISTRATION_OPEN", "false");
    expect(isRegistrationOpen()).toBe(false);
  });
});
