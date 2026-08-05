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

/** The same lookup, narrowed to one arm of the union so a test can read the bounds that arm owns. */
const intDefinitionOf = (key: string) => {
  const found = definitionOf(key);
  if (found.type !== "int") {
    throw new Error(`${key} is not an int setting`);
  }
  return found;
};

const textDefinitionOf = (key: string) => {
  const found = definitionOf(key);
  if (found.type !== "text") {
    throw new Error(`${key} is not a text setting`);
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
    // distrust the whole screen. The seed carries 16 keys; these 9 are the editable ones.
    //
    // The four `documents.*` keys are the ONE documented exception, and only until the next slice:
    // EPIC-2-DOCUMENTS makes Phase 0 the letterhead so the owner can enter and verify it before a
    // PDF exists, and Phase 1 is what reads them. If that phase is ever abandoned, these four come
    // out with it rather than lingering as controls that configure nothing.
    expect(PREFERENCE_SETTINGS.map((setting) => setting.key)).toEqual([
      "orders.logisticsSpacingMinutes",
      "orders.turnaroundMinutes",
      "orders.evidenceMinPhotos",
      "orders.evidenceMaxPhotos",
      "orders.evidenceRetentionMonths",
      "documents.businessName",
      "documents.businessPhone",
      "documents.terms",
      "documents.quoteValidityDays",
    ]);
    // Every one carries bounds the client mirrors while typing, and a fallback INSIDE them — a
    // fallback outside its own range would be a value the API refuses to accept back.
    for (const setting of PREFERENCE_SETTINGS) {
      if (setting.type === "text") {
        expect(setting.maxLength).toBeGreaterThan(setting.minLength);
        expect(setting.fallback.length).toBeLessThanOrEqual(setting.maxLength);
        // An OPTIONAL text may default to empty; a required one may not default to unusable.
        if (setting.minLength > 0) {
          expect(setting.fallback.length).toBeGreaterThanOrEqual(setting.minLength);
        }
        continue;
      }
      expect(setting.max).toBeGreaterThan(setting.min);
      expect(setting.fallback).toBeGreaterThanOrEqual(setting.min);
      expect(setting.fallback).toBeLessThanOrEqual(setting.max);
    }
  });

  it("forbids a line break everywhere except the terms block", () => {
    // A business name or a phone spanning two lines is a broken letterhead, not a name. The terms
    // are a paragraph, so they are the one place newlines are meaningful.
    const multiline = PREFERENCE_SETTINGS.filter(
      (setting) => setting.type === "text" && setting.multiline,
    ).map((setting) => setting.key);
    expect(multiline).toEqual(["documents.terms"]);
  });

  it("lets the turnaround be ZERO but never the spacing", () => {
    // A business with no cleaning step is real; two deliveries at the same instant are not.
    expect(intDefinitionOf("orders.turnaroundMinutes").min).toBe(0);
    expect(intDefinitionOf("orders.logisticsSpacingMinutes").min).toBe(1);
  });

  it("requires the business NAME but lets the phone and the terms be empty", () => {
    // A document with no letterhead is broken, so the name has no legitimate empty state. Inventing
    // a phone number, on the other hand, would print a wrong one on every document — and unwritten
    // terms are simply a document without that paragraph.
    expect(textDefinitionOf("documents.businessName").minLength).toBeGreaterThan(0);
    expect(textDefinitionOf("documents.businessPhone").minLength).toBe(0);
    expect(textDefinitionOf("documents.terms").minLength).toBe(0);
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
  const spacing = intDefinitionOf("orders.logisticsSpacingMinutes");

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

  describe("text settings", () => {
    const name = textDefinitionOf("documents.businessName");
    const terms = textDefinitionOf("documents.terms");

    it("reads a stored string as it stands", () => {
      expect(readSettingValue(name, "Alquileres El Sol")).toBe("Alquileres El Sol");
    });

    it("TRUNCATES an over-long stored value rather than printing it", () => {
      // The same stance as clamping an integer: a hand-edited row resolves to its nearest legal
      // value. A 4000-character "business name" would otherwise reach the letterhead.
      expect(readSettingValue(name, "x".repeat(500))).toHaveLength(name.maxLength);
    });

    it("falls back when a REQUIRED text is missing or too short", () => {
      // An empty `businessName` is a missing configuration, not a choice.
      expect(readSettingValue(name, undefined)).toBe(name.fallback);
      expect(readSettingValue(name, "")).toBe(name.fallback);
    });

    it("keeps an OPTIONAL text's empty value, which is a real answer", () => {
      // `minLength: 0` ⇒ "" is legal, so it must survive the read: a business that deliberately
      // prints no terms must not have a default paragraph reappear on every document.
      expect(readSettingValue(terms, "")).toBe("");
    });
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

  it("publishes a text setting with its OWN bounds, not an integer's", async () => {
    // The two arms carry different constraints, and the client narrows on `type` — so a text
    // setting arriving with `min`/`max` (or without `multiline`) would leave it unable to validate
    // anything as the admin types.
    const settings = await loadSettings(client([{ key: "documents.terms", value: "Cualquier daño…" }]));
    expect(settings.find((setting) => setting.key === "documents.terms")).toEqual({
      key: "documents.terms",
      type: "text",
      value: "Cualquier daño…",
      minLength: 0,
      maxLength: 1200,
      multiline: true,
      group: "documents",
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

  it("records the DECLARED valueType, so a text setting isn't stored as an int", async () => {
    // `value` is text in the table either way; `valueType` is how anything reading these rows raw —
    // a seed, a migration, a person — knows how to parse them.
    const prisma = client([]);
    await writeSettings(prisma, [{ key: "documents.businessName", value: "Alquileres El Sol" }]);
    expect(prisma.appPreference.upsert).toHaveBeenCalledWith({
      where: { key: "documents.businessName" },
      update: { value: "Alquileres El Sol" },
      create: {
        key: "documents.businessName",
        value: "Alquileres El Sol",
        valueType: "text",
        group: "documents",
      },
    });
  });
});
