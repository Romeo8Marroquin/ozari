import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAppHost,
  getNodeEnv,
  isDeployedEnvironment,
  isProductionEnvironment,
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
});
