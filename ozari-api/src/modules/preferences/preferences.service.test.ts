import { describe, expect, it, vi } from "vitest";
import { appConfig } from "@/config/app.js";
import {
  loadSettings,
  PREFERENCE_SETTINGS,
  readSettingValue,
  settingDefinitionFor,
  writeSettings,
} from "./preferences.service.js";

const definitionOf = (key: string) => {
  const found = PREFERENCE_SETTINGS.find((setting) => setting.key === key);
  if (!found) {
    throw new Error(`missing definition for ${key}`);
  }
  return found;
};

const client = (rows: Array<{ key: string; value: string }>) => ({
  appPreference: {
    findMany: vi.fn().mockResolvedValue(rows),
    upsert: vi.fn().mockResolvedValue({}),
  },
});

describe("PREFERENCE_SETTINGS", () => {
  it("exposes ONLY the settings the system actually honours", () => {
    // Owner rule 2026-07-29: a control that saves a value nothing reads teaches the admin to
    // distrust the whole screen. The seed carries 12 keys; these 5 are the ones code reads.
    expect(PREFERENCE_SETTINGS.map((setting) => setting.key)).toEqual([
      "orders.logisticsSpacingMinutes",
      "orders.turnaroundMinutes",
      "orders.evidenceMinPhotos",
      "orders.evidenceMaxPhotos",
      "orders.evidenceRetentionMonths",
    ]);
    // Every one carries bounds the client mirrors while typing, and a seeded fallback.
    for (const setting of PREFERENCE_SETTINGS) {
      expect(setting.max).toBeGreaterThan(setting.min);
      expect(setting.fallback).toBeGreaterThanOrEqual(setting.min);
      expect(setting.fallback).toBeLessThanOrEqual(setting.max);
    }
  });

  it("lets the turnaround be ZERO but never the spacing", () => {
    // A business with no cleaning step is real; two deliveries at the same instant are not.
    expect(definitionOf("orders.turnaroundMinutes").min).toBe(0);
    expect(definitionOf("orders.logisticsSpacingMinutes").min).toBe(1);
  });

  it("resolves only its own keys, and hands back the BOUNDS with them", () => {
    // One lookup answers both "may this be written?" and "within what range?" — the validator needs
    // both, and two lookups would be two chances to disagree.
    expect(settingDefinitionFor("orders.turnaroundMinutes")).toMatchObject({ min: 0, max: 1440 });
    // Seeded, but nothing reads it yet — so it is not editable here.
    expect(settingDefinitionFor("notifications.digestFrequency")).toBeUndefined();
    expect(settingDefinitionFor("nope")).toBeUndefined();
  });
});

describe("readSettingValue", () => {
  const spacing = definitionOf("orders.logisticsSpacingMinutes");

  it("reads a stored integer", () => {
    expect(readSettingValue(spacing, "90")).toBe(90);
  });

  it("falls back on a missing or non-integer value", () => {
    expect(readSettingValue(spacing, undefined)).toBe(appConfig.defaultLogisticsSpacingMinutes);
    expect(readSettingValue(spacing, "abc")).toBe(appConfig.defaultLogisticsSpacingMinutes);
    expect(readSettingValue(spacing, "1.5")).toBe(appConfig.defaultLogisticsSpacingMinutes);
  });

  it("CLAMPS a hand-edited value into the declared bounds rather than trusting it", () => {
    // A row edited straight in the database must read as its nearest legal value — a booking rule
    // silently running on 0 or 99999 minutes is worse than one running on the boundary.
    expect(readSettingValue(spacing, "0")).toBe(spacing.min);
    expect(readSettingValue(spacing, "999999")).toBe(spacing.max);
  });
});

describe("loadSettings", () => {
  it("returns every editable setting with its value and bounds", async () => {
    const prisma = client([{ key: "orders.turnaroundMinutes", value: "45" }]);
    const settings = await loadSettings(prisma);

    expect(settings).toHaveLength(PREFERENCE_SETTINGS.length);
    expect(settings.find((setting) => setting.key === "orders.turnaroundMinutes")).toEqual({
      key: "orders.turnaroundMinutes",
      type: "int",
      value: 45,
      min: 0,
      max: 1440,
      group: "orders",
    });
  });

  it("is complete on a database seeded BEFORE a setting existed", async () => {
    // Every unseeded key resolves to its fallback, so the screen renders in full rather than
    // half-empty on exactly the databases that need it most.
    const settings = await loadSettings(client([]));
    expect(settings.map((setting) => setting.value)).toEqual(
      PREFERENCE_SETTINGS.map((setting) => setting.fallback),
    );
  });
});

describe("writeSettings", () => {
  it("UPSERTS, so a setting with no row yet is created rather than failing", async () => {
    const prisma = client([]);
    await writeSettings(prisma, [{ key: "orders.turnaroundMinutes", value: 30 }]);

    expect(prisma.appPreference.upsert).toHaveBeenCalledWith({
      where: { key: "orders.turnaroundMinutes" },
      update: { value: "30" },
      create: {
        key: "orders.turnaroundMinutes",
        value: "30",
        valueType: "int",
        group: "orders",
      },
    });
  });

  it("carries the registry's group onto a created row", async () => {
    const prisma = client([]);
    await writeSettings(prisma, [{ key: "orders.evidenceMinPhotos", value: 2 }]);
    expect(prisma.appPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ group: "evidence" }) }),
    );
  });
});
