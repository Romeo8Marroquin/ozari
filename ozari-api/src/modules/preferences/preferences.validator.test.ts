import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { appConfig } from "@/config/app.js";
import {
  validateCatalogRow,
  validateUpdatePreferenceSettings,
} from "./preferences.validator.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

/** The municipality lookup the `ref` field kind performs. */
const mockPrisma = (municipality: unknown = { id: 4 }) => {
  const findFirst = vi.fn().mockResolvedValue(municipality);
  (getPrismaClient as Mock).mockResolvedValue({ municipality: { findFirst } });
  return findFirst;
};

const expectRejected = (key: string, status = HttpEnum.BAD_REQUEST) =>
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    status,
    `preferences.validators.${key}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma();
});

describe("validateUpdatePreferenceSettings", () => {
  const run = (body: unknown) => {
    const req = { body } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    validateUpdatePreferenceSettings(req, {} as Response, next);
    return { req, next };
  };

  it("accepts the editable set and passes it through", () => {
    const { req, next } = run({
      settings: [
        { key: "orders.logisticsSpacingMinutes", value: 90 },
        { key: "orders.turnaroundMinutes", value: 0 },
      ],
    });
    expect(next).toHaveBeenCalled();
    expect((req.body as { settings: unknown[] }).settings).toHaveLength(2);
  });

  it.each([
    ["invalidSettings", { settings: [] }],
    ["invalidSettings", { settings: "nope" }],
    ["invalidSettings", { settings: Array.from({ length: 99 }, () => ({ key: "x", value: 1 })) }],
    ["unknownSetting", { settings: [{ key: "nope", value: 1 }] }],
    // Seeded but honoured by nothing yet — deliberately NOT editable (owner rule 2026-07-29).
    ["unknownSetting", { settings: [{ key: "notifications.digestFrequency", value: 1 }] }],
    ["unknownSetting", { settings: [{ key: 42, value: 1 }] }],
    [
      "duplicateSetting",
      {
        settings: [
          { key: "orders.turnaroundMinutes", value: 10 },
          { key: "orders.turnaroundMinutes", value: 20 },
        ],
      },
    ],
    ["invalidSettingValue", { settings: [{ key: "orders.turnaroundMinutes", value: -1 }] }],
    ["invalidSettingValue", { settings: [{ key: "orders.turnaroundMinutes", value: 99999 }] }],
    ["invalidSettingValue", { settings: [{ key: "orders.turnaroundMinutes", value: 1.5 }] }],
    ["invalidSettingValue", { settings: [{ key: "orders.turnaroundMinutes", value: "30" }] }],
    // Spacing may not be zero even though the turnaround may — one van can't do two at once.
    ["invalidSettingValue", { settings: [{ key: "orders.logisticsSpacingMinutes", value: 0 }] }],
  ])("rejects %s", (key, body) => {
    const { next } = run(body);
    expect(next).not.toHaveBeenCalled();
    expectRejected(key);
  });

  it("rejects an INVERTED evidence range — no photo count could ever satisfy it", () => {
    const { next } = run({
      settings: [
        { key: "orders.evidenceMinPhotos", value: 5 },
        { key: "orders.evidenceMaxPhotos", value: 2 },
      ],
    });
    expect(next).not.toHaveBeenCalled();
    expectRejected("invertedEvidenceRange");
  });

  it("accepts an evidence range where max equals min", () => {
    const { next } = run({
      settings: [
        { key: "orders.evidenceMinPhotos", value: 3 },
        { key: "orders.evidenceMaxPhotos", value: 3 },
      ],
    });
    expect(next).toHaveBeenCalled();
  });

  it("responds 500 when the body cannot even be read", () => {
    const req = {
      get body() {
        throw new Error("boom");
      },
    } as unknown as Request;
    validateUpdatePreferenceSettings(req, {} as Response, vi.fn() as unknown as NextFunction);
    expectRejected("validationError", HttpEnum.INTERNAL_SERVER_ERROR);
  });
});

describe("validateCatalogRow", () => {
  const run = async (catalog: string, body: unknown) => {
    const req = { params: { catalog }, body } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    await validateCatalogRow(req, {} as Response, next);
    return { req, next };
  };
  const valid = { name: "Boda", description: "  Con salón  ", isActive: true };

  it("accepts a plain catalog row, trimming its texts", async () => {
    const { req, next } = await run("contact-types", { ...valid, name: "  Telegram  " });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: "Telegram", description: "Con salón", isActive: true });
  });

  it("answers 404 — not 400 — for a catalog that is not manageable", async () => {
    // The segment names a resource. An unlisted table must read as "no such thing here", never as
    // merely malformed: that is how the code-anchored lookups (roles, currencies…) stay invisible.
    const { next } = await run("rent-time-units", valid);
    expect(next).not.toHaveBeenCalled();
    expectRejected("unknownCatalog", HttpEnum.NOT_FOUND);
  });

  it.each([
    ["invalidName", { ...valid, name: "x" }],
    ["invalidName", { ...valid, name: "  " }],
    ["invalidName", { ...valid, name: 42 }],
    ["invalidName", { ...valid, name: "x".repeat(101) }],
    ["invalidDescription", { ...valid, description: "y".repeat(501) }],
    ["invalidDescription", { ...valid, description: 42 }],
    ["invalidIsActive", { ...valid, isActive: "yes" }],
  ])("rejects %s", async (key, body) => {
    const { next } = await run("contact-types", body);
    expect(next).not.toHaveBeenCalled();
    expectRejected(key);
  });

  it("treats an absent description as absent, not as an error", async () => {
    for (const description of [undefined, null, ""]) {
      vi.clearAllMocks();
      const { req, next } = await run("contact-types", { ...valid, description });
      expect(next).toHaveBeenCalled();
      expect((req.body as { description: unknown }).description).toBeUndefined();
    }
  });

  it("bounds an event type's lead hours", async () => {
    const { req, next } = await run("event-types", { ...valid, minLeadHours: 48 });
    expect(next).toHaveBeenCalled();
    expect((req.body as { minLeadHours: number }).minLeadHours).toBe(48);

    for (const minLeadHours of [-1, 1.5, "24", undefined, 24 * 365 + 1]) {
      vi.clearAllMocks();
      const rejected = await run("event-types", { ...valid, minLeadHours });
      expect(rejected.next).not.toHaveBeenCalled();
      expectRejected("invalidExtraField");
    }
  });

  it("keeps a zone's fee NULLABLE — 'not configured' is not the same answer as free", async () => {
    for (const deliveryFee of [undefined, null]) {
      vi.clearAllMocks();
      const { req, next } = await run("zones", { ...valid, municipalityId: 4, deliveryFee });
      expect(next).toHaveBeenCalled();
      expect((req.body as { deliveryFee: unknown }).deliveryFee).toBeNull();
    }

    vi.clearAllMocks();
    const { req } = await run("zones", { ...valid, municipalityId: 4, deliveryFee: 50.999 });
    // Truncated to cents, exactly like every other money field in the codebase.
    expect((req.body as { deliveryFee: number }).deliveryFee).toBe(50.99);
  });

  it("rejects an out-of-range or non-numeric fee", async () => {
    for (const deliveryFee of [-1, "50", appConfig.maxGlobalAmount + 1, Number.NaN]) {
      vi.clearAllMocks();
      const { next } = await run("zones", { ...valid, municipalityId: 4, deliveryFee });
      expect(next).not.toHaveBeenCalled();
      expectRejected("invalidExtraField");
    }
  });

  it("requires a zone's municipality to exist AND be published", async () => {
    // A zone pointing at a retired municipality would render with a dangling parent.
    mockPrisma(null);
    const { next } = await run("zones", { ...valid, municipalityId: 99, deliveryFee: null });
    expect(next).not.toHaveBeenCalled();
    expectRejected("invalidExtraField");

    for (const municipalityId of [0, "4", 1.5, undefined]) {
      vi.clearAllMocks();
      mockPrisma();
      const rejected = await run("zones", { ...valid, municipalityId, deliveryFee: null });
      expect(rejected.next).not.toHaveBeenCalled();
      expectRejected("invalidExtraField");
    }
  });

  it("never sends a catalog a field it does not declare", async () => {
    // An event type has no fee, and a contact type has no lead hours — the registry decides, so a
    // stray field in the body is simply dropped rather than written somewhere it doesn't belong.
    const { req } = await run("contact-types", { ...valid, deliveryFee: 999, minLeadHours: 5 });
    expect(req.body).toEqual({ name: "Boda", description: "Con salón", isActive: true });
  });

  it("responds 500 when the reference lookup blows up", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await run("zones", { ...valid, municipalityId: 4, deliveryFee: null });
    expectRejected("validationError", HttpEnum.INTERNAL_SERVER_ERROR);
  });
});
