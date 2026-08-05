import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { encryptKms } from "@helpers/encryption.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import type { CustomRequest } from "@models/common/customRequestModel.js";
import {
  createCatalogRow,
  deleteCatalogRow,
  getPreferences,
  updateCatalogRow,
  updatePreferenceSettings,
} from "./preferences.controller.js";
import { CATALOG_RESPONSE_KEYS, PREFERENCE_CATALOGS } from "./preferences.catalogs.js";
import { PREFERENCE_SETTINGS } from "./preferences.service.js";
import type {
  DeleteCatalogRowResponseModel,
  PreferenceCatalogRowEnvelopeModel,
  PreferencesResponseModel,
} from "./preferences.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({ isDeployedEnvironment: vi.fn(() => false) }));

/** A lookup row as the catalogs select it. */
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Row ${id}`,
  description: null,
  isActive: true,
  ...over,
});

interface PrismaOverrides {
  /** How many ACTIVE rows the catalog reports (drives the last-active invariant). */
  activeCount?: number;
  /** What `find` resolves to — `null` = the row doesn't exist. */
  existing?: Record<string, unknown> | null;
  /** Which ids something points at (drives the `isReferenced` flags and delete vs deactivate). */
  usedIds?: Array<number | null>;
}

/** A `groupBy` row carrying the id under every FK name, so one mock serves all six catalogs. */
const groupRows = (ids: Array<number | null>) =>
  ids.map((id) => ({
    eventTypeId: id,
    contactTypeId: id,
    zoneId: id,
    paymentMethodId: id,
    preferredPaymentMethodId: id,
    productCategoryId: id,
    productDetailTypeId: id,
  }));

function mockPrisma(overrides: PrismaOverrides = {}) {
  const lookup = {
    findMany: vi.fn().mockResolvedValue([row(1), row(2, { isActive: false })]),
    findUnique: vi
      .fn()
      .mockResolvedValue(overrides.existing === undefined ? row(1) : overrides.existing),
    create: vi.fn().mockResolvedValue(row(9)),
    update: vi.fn().mockResolvedValue(row(1)),
    delete: vi.fn().mockResolvedValue(row(1)),
    count: vi.fn().mockResolvedValue(overrides.activeCount ?? 3),
  };
  // Zones select extra columns, so they need their own resolved shapes.
  const zone = {
    ...lookup,
    findMany: vi
      .fn()
      .mockResolvedValue([
        row(1, { deliveryFee: new Prisma.Decimal("50.00"), municipalityId: 4 }),
        row(2, { deliveryFee: null, municipalityId: 4, isActive: false }),
      ]),
    findUnique: vi.fn().mockResolvedValue(
      overrides.existing === undefined
        ? row(1, { deliveryFee: new Prisma.Decimal("50.00"), municipalityId: 4 })
        : overrides.existing,
    ),
    create: vi.fn().mockResolvedValue(row(9, { deliveryFee: null, municipalityId: 4 })),
    update: vi
      .fn()
      .mockResolvedValue(row(1, { deliveryFee: new Prisma.Decimal("75.00"), municipalityId: 4 })),
  };
  const eventType = {
    ...lookup,
    findMany: vi.fn().mockResolvedValue([row(1, { minLeadHours: 24 })]),
    findUnique: vi
      .fn()
      .mockResolvedValue(
        overrides.existing === undefined ? row(1, { minLeadHours: 24 }) : overrides.existing,
      ),
    create: vi.fn().mockResolvedValue(row(9, { minLeadHours: 48 })),
    update: vi.fn().mockResolvedValue(row(1, { minLeadHours: 48 })),
  };
  // Bank accounts select two ENCRYPTED columns, so their rows carry real ciphertexts.
  const bankRow = (id: number, over: Record<string, unknown> = {}) =>
    row(id, {
      bankKey: "banrural",
      accountType: "Monetaria",
      accountNumberKms: encryptKms("3-456-78901-2"),
      holderKms: encryptKms("Party Rentals GT, S.A."),
      ...over,
    });
  const bankAccount = {
    ...lookup,
    findMany: vi.fn().mockResolvedValue([bankRow(1), bankRow(2, { isActive: false })]),
    findUnique: vi
      .fn()
      .mockResolvedValue(overrides.existing === undefined ? bankRow(1) : overrides.existing),
    create: vi.fn().mockResolvedValue(bankRow(9)),
    update: vi.fn().mockResolvedValue(bankRow(1)),
  };
  const referencing = { groupBy: vi.fn().mockResolvedValue(groupRows(overrides.usedIds ?? [])) };
  const client = {
    appPreference: {
      findMany: vi.fn().mockResolvedValue([{ key: "orders.turnaroundMinutes", value: "90" }]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    eventType,
    contactType: lookup,
    zone,
    paymentMethod: lookup,
    productCategory: lookup,
    productDetailType: lookup,
    bankAccount,
    municipality: {
      findMany: vi.fn().mockResolvedValue([row(4, { name: "Mixco" })]),
      findFirst: vi.fn().mockResolvedValue(row(4)),
    },
    service: referencing,
    clientRegistry: referencing,
    clientRegistryContact: referencing,
    clientRegistryAddress: referencing,
    address: referencing,
    product: referencing,
    productDetail: referencing,
    $transaction: vi.fn(),
  };
  client.$transaction = vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client));
  (getPrismaClient as Mock).mockResolvedValue(client);
  return client;
}

const buildReq = (
  params: Record<string, string> = {},
  body: unknown = {},
): CustomRequest =>
  ({ params, body, query: {}, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

const successData = <T>(): T => (sendOzariSuccess as Mock).mock.calls[0]?.[3] as T;

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
});

beforeEach(() => vi.clearAllMocks());

describe("getPreferences", () => {
  it("returns the settings, every manageable catalog, and the zone form's municipalities", async () => {
    mockPrisma();
    await getPreferences(buildReq(), {} as Response);

    const data = successData<PreferencesResponseModel>();
    expect(data.settings).toHaveLength(PREFERENCE_SETTINGS.length);
    expect(data.settings.find((s) => s.key === "orders.turnaroundMinutes")?.value).toBe(90);
    expect(Object.keys(data.catalogs)).toEqual([
      "eventTypes",
      "contactTypes",
      "zones",
      "paymentMethods",
      "productCategories",
      "productDetailTypes",
      "bankAccounts",
    ]);
    // The extras arrive typed, and a Decimal fee becomes a plain number.
    expect(data.catalogs.eventTypes[0]).toMatchObject({ minLeadHours: 24 });
    expect(data.catalogs.zones[0]).toMatchObject({ deliveryFee: 50, municipalityId: 4 });
    // The bank secrets arrive DECRYPTED — this Admin-only screen is the one place they are readable,
    // and it is where the admin edits them.
    expect(data.catalogs.bankAccounts[0]).toMatchObject({
      bankKey: "banrural",
      accountType: "Monetaria",
      accountNumber: "3-456-78901-2",
      holder: "Party Rentals GT, S.A.",
    });
    // An unconfigured fee is ABSENT, never 0 — "not set" and "free" are different answers.
    expect(data.catalogs.zones[1]).not.toHaveProperty("deliveryFee");
    expect(data.municipalities).toEqual([
      { id: 4, name: "Mixco", description: undefined, isActive: true },
    ]);
  });

  it("flags which rows something POINTS AT, so a delete dialog can name the outcome", async () => {
    // Row 1 is in use, row 2 isn't. The whole catalog is answered by one `GROUP BY` per relation —
    // never a query per row.
    const client = mockPrisma({ usedIds: [1] });
    await getPreferences(buildReq(), {} as Response);

    const data = successData<PreferencesResponseModel>();
    expect(data.catalogs.contactTypes.map((r) => r.isReferenced)).toEqual([true, false]);
    // Exactly ONE query per declared relation for the whole screen (the mock shares one delegate
    // across every referencing table, so this counts them all). Derived from the registry so adding
    // a catalog can't silently turn this into a query per row.
    const relations = CATALOG_RESPONSE_KEYS.reduce(
      (total, [, key]) => total + PREFERENCE_CATALOGS[key].referencedBy.length,
      0,
    );
    expect(client.clientRegistryContact.groupBy).toHaveBeenCalledTimes(relations);
    // Municipalities are plain reference data, not a manageable catalog — no flag, nothing to delete.
    expect(data.municipalities[0]).not.toHaveProperty("isReferenced");
  });

  it("INCLUDES unpublished rows — this is the screen where isActive is edited", async () => {
    mockPrisma();
    await getPreferences(buildReq(), {} as Response);
    const data = successData<PreferencesResponseModel>();
    // Hiding inactive rows here would make them unrecoverable.
    expect(data.catalogs.contactTypes.map((r) => r.isActive)).toEqual([true, false]);
  });

  it("responds 500 when a read fails", async () => {
    const client = mockPrisma();
    client.appPreference.findMany.mockRejectedValue(new Error("db down"));
    await getPreferences(buildReq(), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "preferences.getPreferences.errorFetching",
    );
  });
});

describe("updatePreferenceSettings", () => {
  it("writes the set and answers with the RELOADED values", async () => {
    const client = mockPrisma();
    await updatePreferenceSettings(
      buildReq({}, { settings: [{ key: "orders.turnaroundMinutes", value: 90 }] }),
      {} as Response,
    );

    expect(client.appPreference.upsert).toHaveBeenCalledTimes(1);
    // Re-read, not echoed: a clamped or upserted value would otherwise diverge silently.
    expect(client.appPreference.findMany).toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "preferences.updateSettings.settingsUpdated",
      expect.objectContaining({ settings: expect.any(Array) }),
    );
  });

  it("responds 500 when the write fails", async () => {
    const client = mockPrisma();
    client.appPreference.upsert.mockRejectedValue(new Error("db down"));
    await updatePreferenceSettings(
      buildReq({}, { settings: [{ key: "orders.turnaroundMinutes", value: 90 }] }),
      {} as Response,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "preferences.updateSettings.errorUpdating",
    );
  });
});

describe("createCatalogRow", () => {
  it("adds a row and returns it", async () => {
    const client = mockPrisma();
    await createCatalogRow(
      buildReq({ catalog: "event-types" }, { name: "Boda", description: undefined, isActive: true, minLeadHours: 48 }),
      {} as Response,
    );

    expect(client.eventType.create).toHaveBeenCalled();
    expect(successData<PreferenceCatalogRowEnvelopeModel>().row).toMatchObject({
      id: 9,
      minLeadHours: 48,
      // A row that did not exist a moment ago cannot be in use — asserted, not queried.
      isReferenced: false,
    });
    expect(client.service.groupBy).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      "preferences.catalogs.rowCreated",
      expect.anything(),
    );
  });

  it("writes a zone's municipality and its fee", async () => {
    const client = mockPrisma();
    await createCatalogRow(
      buildReq(
        { catalog: "zones" },
        { name: "Zona 26", description: undefined, isActive: true, municipalityId: 4, deliveryFee: null },
      ),
      {} as Response,
    );
    expect(client.zone.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ municipalityId: 4, deliveryFee: null }),
      }),
    );
  });

  it("answers 404 for a catalog that is not manageable", async () => {
    // Roles, currencies, business types… code branches on their ids, so they must read as "no such
    // thing here" rather than as a malformed request.
    mockPrisma();
    await createCatalogRow(buildReq({ catalog: "user-roles" }, {}), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.unknownCatalog",
    );
  });

  it("responds 500 when the insert fails", async () => {
    const client = mockPrisma();
    client.contactType.create.mockRejectedValue(new Error("db down"));
    await createCatalogRow(
      buildReq({ catalog: "contact-types" }, { name: "Telegram", description: undefined, isActive: true }),
      {} as Response,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "preferences.catalogs.errorCreating",
    );
  });
});

describe("updateCatalogRow", () => {
  const body = { name: "Boda", description: undefined, isActive: true, minLeadHours: 48 };

  it("updates a row, and the reference flag travels with it", async () => {
    // The client replaces its cached row wholesale, so an edit that dropped the flag would send the
    // delete dialog back to hedging about the outcome.
    const client = mockPrisma({ usedIds: [1] });
    await updateCatalogRow(buildReq({ catalog: "event-types", id: "1" }, body), {} as Response);
    expect(client.eventType.update).toHaveBeenCalled();
    expect(successData<PreferenceCatalogRowEnvelopeModel>().row).toMatchObject({
      minLeadHours: 48,
      isReferenced: true,
    });
  });

  it("answers 404 for an unknown catalog, a malformed id, and a missing row", async () => {
    mockPrisma();
    await updateCatalogRow(buildReq({ catalog: "nope", id: "1" }, body), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.unknownCatalog",
    );

    vi.clearAllMocks();
    mockPrisma();
    await updateCatalogRow(buildReq({ catalog: "event-types", id: "abc" }, body), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.rowNotFound",
    );

    vi.clearAllMocks();
    mockPrisma({ existing: null });
    await updateCatalogRow(buildReq({ catalog: "event-types", id: "77" }, body), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.rowNotFound",
    );
  });

  it("REFUSES to unpublish the last active row of a catalog the forms need", async () => {
    // Leaving zero active event types doesn't just look odd — it drops the order form into its
    // `config` dead-end, which is far harder to diagnose than a refused edit.
    const client = mockPrisma({ activeCount: 1 });
    await updateCatalogRow(
      buildReq({ catalog: "event-types", id: "1" }, { ...body, isActive: false }),
      {} as Response,
    );
    expect(client.eventType.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "preferences.catalogs.lastActive",
    );
  });

  it("allows unpublishing when another active row remains, and for OPTIONAL catalogs always", async () => {
    const client = mockPrisma({ activeCount: 2 });
    await updateCatalogRow(
      buildReq({ catalog: "event-types", id: "1" }, { ...body, isActive: false }),
      {} as Response,
    );
    expect(client.eventType.update).toHaveBeenCalled();

    // Zones/payment methods/detail types are genuinely optional: zero is a valid configuration.
    vi.clearAllMocks();
    const optional = mockPrisma({ activeCount: 1 });
    await updateCatalogRow(
      buildReq({ catalog: "payment-methods", id: "1" }, { name: "Efectivo", description: undefined, isActive: false }),
      {} as Response,
    );
    expect(optional.paymentMethod.update).toHaveBeenCalled();
  });

  it("responds 500 when the update fails", async () => {
    const client = mockPrisma();
    client.eventType.update.mockRejectedValue(new Error("db down"));
    await updateCatalogRow(buildReq({ catalog: "event-types", id: "1" }, body), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "preferences.catalogs.errorUpdating",
    );
  });
});

describe("deleteCatalogRow", () => {
  it("HARD-deletes a row nothing references", async () => {
    const client = mockPrisma({ usedIds: [] });
    await deleteCatalogRow(buildReq({ catalog: "contact-types", id: "1" }), {} as Response);

    expect(client.contactType.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(successData<DeleteCatalogRowResponseModel>()).toEqual({ outcome: "deleted" });
  });

  it("DEACTIVATES a row something references, and says which happened", async () => {
    // An order holds a live FK to its event type — destroying a used row would leave its detail page
    // unable to name it. The outcome travels so the client's copy can be truthful.
    const client = mockPrisma({ usedIds: [1] });
    await deleteCatalogRow(buildReq({ catalog: "event-types", id: "1" }), {} as Response);

    expect(client.eventType.delete).not.toHaveBeenCalled();
    expect(client.eventType.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
    expect(successData<DeleteCatalogRowResponseModel>()).toEqual({ outcome: "deactivated" });
  });

  it("checks EVERY table that can reference a row", async () => {
    // A zone is referenced from user addresses AND registry addresses; a payment method from orders
    // AND a client's preferred method. Missing one would hard-delete a row still in use.
    const client = mockPrisma({ usedIds: [] });
    await deleteCatalogRow(buildReq({ catalog: "zones", id: "1" }), {} as Response);
    expect(client.address.groupBy).toHaveBeenCalledWith({ by: ["zoneId"] });
    expect(client.clientRegistryAddress.groupBy).toHaveBeenCalledWith({ by: ["zoneId"] });

    vi.clearAllMocks();
    const methods = mockPrisma({ usedIds: [] });
    await deleteCatalogRow(buildReq({ catalog: "payment-methods", id: "1" }), {} as Response);
    expect(methods.service.groupBy).toHaveBeenCalledWith({ by: ["paymentMethodId"] });
    expect(methods.clientRegistry.groupBy).toHaveBeenCalledWith({
      by: ["preferredPaymentMethodId"],
    });
  });

  it("refuses to remove the last active row of a required catalog, by EITHER door", async () => {
    const client = mockPrisma({ activeCount: 1, usedIds: [] });
    await deleteCatalogRow(buildReq({ catalog: "product-categories", id: "1" }), {} as Response);
    expect(client.productCategory.delete).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "preferences.catalogs.lastActive",
    );
  });

  it("lets an ALREADY-unpublished row go even when it is the last one", async () => {
    // The invariant is about ACTIVE rows; deleting an inactive row can't strand a form.
    const client = mockPrisma({ activeCount: 1, usedIds: [], existing: row(1, { isActive: false }) });
    await deleteCatalogRow(buildReq({ catalog: "product-categories", id: "1" }), {} as Response);
    expect(client.productCategory.delete).toHaveBeenCalled();
  });

  it("answers 404 for an unknown catalog, a malformed id, and a missing row", async () => {
    mockPrisma();
    await deleteCatalogRow(buildReq({ catalog: "currencies", id: "1" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.unknownCatalog",
    );

    vi.clearAllMocks();
    mockPrisma();
    await deleteCatalogRow(buildReq({ catalog: "zones", id: "0" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.rowNotFound",
    );

    vi.clearAllMocks();
    mockPrisma({ existing: null });
    await deleteCatalogRow(buildReq({ catalog: "zones", id: "5" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "preferences.catalogs.rowNotFound",
    );
  });

  it("responds 500 when the delete fails", async () => {
    const client = mockPrisma({ references: 0 });
    client.contactType.delete.mockRejectedValue(new Error("db down"));
    await deleteCatalogRow(buildReq({ catalog: "contact-types", id: "1" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "preferences.catalogs.errorDeleting",
    );
  });
});
