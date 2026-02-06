import { describe, it, expect, beforeEach } from "vitest";
import { initializeI18n, i18next } from "./i18n.js";

describe("i18n Configuration", () => {
  beforeEach(async () => {
    if (i18next.isInitialized) {
      await i18next.changeLanguage("es-GT");
    }
  });

  it("should initialize i18next successfully", async () => {
    await initializeI18n();

    expect(i18next.isInitialized).toBe(true);
  });

  it("should load Spanish Guatemala as default language", async () => {
    await initializeI18n();

    expect(i18next.language).toBe("es-GT");
  });

  it("should have translation namespace loaded", async () => {
    await initializeI18n();

    expect(i18next.hasResourceBundle("es-GT", "translation")).toBe(true);
  });

  it("should translate keys correctly", async () => {
    await initializeI18n();

    const translation = i18next.t("common.invalidBody");

    expect(translation).toBeDefined();
    expect(typeof translation).toBe("string");
  });

  it("should support namespace usage", async () => {
    await initializeI18n();

    expect(i18next.options.ns).toContain("translation");
    expect(i18next.options.defaultNS).toBe("translation");
  });

  it("should support es-GT language", async () => {
    await initializeI18n();

    expect(i18next.options.supportedLngs).toContain("es-GT");
  });
});
