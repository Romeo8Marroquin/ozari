import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CATALOG_RESPONSE_KEYS,
  catalogByKey,
  isRowReferenced,
  PREFERENCE_CATALOGS,
  referencedIdsOf,
  type CatalogKey,
} from "./preferences.catalogs.js";

/**
 * The registry is a TABLE, so it is tested as one: every closure of every catalog is driven, rather
 * than trusting that the six entries were written alike. A copy-paste slip in one entry — the wrong
 * `where` on a delete, a missing reference check, an extra field dropped on update — is exactly the
 * bug this shape invites, and the only thing that catches it is exercising each entry.
 */

/** A lookup row as the catalogs select it, plus whatever extras a catalog asks for. */
const row = (id: number, extras: Record<string, unknown> = {}) => ({
  id,
  name: `Row ${id}`,
  description: null,
  isActive: true,
  ...extras,
});

/** The extras each catalog's SELECT returns, so `find`/`create`/`update` resolve realistically. */
const EXTRAS: Partial<Record<CatalogKey, Record<string, unknown>>> = {
  "event-types": { minLeadHours: 24 },
  zones: { deliveryFee: new Prisma.Decimal("50.00"), municipalityId: 4 },
};

/**
 * A `groupBy` result, mocked generically: each row carries the id under EVERY foreign-key name in the
 * system, so whichever column a catalog's closure reads, it finds the same ids. That keeps ONE mock
 * usable for all six entries instead of a per-catalog fixture.
 */
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

function mockClient(
  key: CatalogKey,
  over: { found?: unknown; count?: number; usedIds?: Array<number | null> } = {},
) {
  const extras = EXTRAS[key] ?? {};
  const delegate = {
    findMany: vi.fn().mockResolvedValue([row(1, extras)]),
    findUnique: vi.fn().mockResolvedValue(over.found === undefined ? row(1, extras) : over.found),
    create: vi.fn().mockResolvedValue(row(9, extras)),
    update: vi.fn().mockResolvedValue(row(1, extras)),
    delete: vi.fn().mockResolvedValue(row(1)),
    count: vi.fn().mockResolvedValue(over.count ?? 3),
  };
  const referencing = { groupBy: vi.fn().mockResolvedValue(groupRows(over.usedIds ?? [])) };
  return {
    eventType: delegate,
    contactType: delegate,
    zone: delegate,
    paymentMethod: delegate,
    productCategory: delegate,
    productDetailType: delegate,
    municipality: referencing,
    service: referencing,
    clientRegistry: referencing,
    clientRegistryContact: referencing,
    clientRegistryAddress: referencing,
    address: referencing,
    product: referencing,
    productDetail: referencing,
    delegate,
    referencing,
  };
}

const body = {
  name: "Nuevo",
  description: undefined,
  isActive: true,
  minLeadHours: 48,
  municipalityId: 4,
  deliveryFee: 75,
};

const CATALOG_KEYS = Object.keys(PREFERENCE_CATALOGS) as CatalogKey[];

beforeEach(() => vi.clearAllMocks());

describe("PREFERENCE_CATALOGS", () => {
  it("registers exactly the admin-manageable lookups — and nothing code branches on", () => {
    // The absences are the point: business types (RENT/SELL), rent units (the billing engine only
    // prices Día/Evento), payment status, roles, currencies and the geo tables are addressed by id in
    // runtime code, so an admin must never be able to add or remove their rows.
    expect(CATALOG_KEYS).toEqual([
      "event-types",
      "contact-types",
      "zones",
      "payment-methods",
      "product-categories",
      "product-detail-types",
    ]);
    for (const forbidden of [
      "user-roles",
      "currencies",
      "product-business-types",
      "rent-time-units",
      "payment-status",
      "municipalities",
      "service-status",
    ]) {
      expect(catalogByKey(forbidden)).toBeUndefined();
    }
  });

  it("keeps the response keys and the registry keys in step", () => {
    expect(CATALOG_RESPONSE_KEYS.map(([, key]) => key)).toEqual(CATALOG_KEYS);
  });

  it("requires an active row only where a FORM would break without one", () => {
    // Emptying these drops the order/product forms into their `config` dead-end…
    expect(PREFERENCE_CATALOGS["event-types"].minimumActive).toBe(1);
    expect(PREFERENCE_CATALOGS["contact-types"].minimumActive).toBe(1);
    expect(PREFERENCE_CATALOGS["product-categories"].minimumActive).toBe(1);
    // …while these are genuinely optional: zero is a valid configuration.
    expect(PREFERENCE_CATALOGS["zones"].minimumActive).toBe(0);
    expect(PREFERENCE_CATALOGS["payment-methods"].minimumActive).toBe(0);
    expect(PREFERENCE_CATALOGS["product-detail-types"].minimumActive).toBe(0);
  });

  describe.each(CATALOG_KEYS)("%s", (key) => {
    const catalog = PREFERENCE_CATALOGS[key];

    it("lists rows in a uniform shape, published first", async () => {
      const client = mockClient(key);
      const rows = await catalog.list(client);
      expect(rows[0]).toMatchObject({ id: 1, name: "Row 1", isActive: true });
      // A Prisma `null` description becomes ABSENT, so the client never renders "null".
      expect(rows[0]?.description).toBeUndefined();
      expect(client.delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
      );
    });

    it("finds a row, and answers null for one that is not there", async () => {
      await expect(catalog.find(mockClient(key), 1)).resolves.toMatchObject({ id: 1 });
      await expect(catalog.find(mockClient(key, { found: null }), 99)).resolves.toBeNull();
    });

    it("creates and updates, passing the shared fields through", async () => {
      const client = mockClient(key);
      await expect(catalog.create(client, body)).resolves.toMatchObject({ id: 9 });
      expect(client.delegate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Nuevo", description: null, isActive: true }),
        }),
      );

      await expect(catalog.update(client, 1, body)).resolves.toMatchObject({ id: 1 });
      expect(client.delegate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it("removes and deactivates by id", async () => {
      const client = mockClient(key);
      await catalog.remove(client, 7);
      expect(client.delegate.delete).toHaveBeenCalledWith({ where: { id: 7 } });

      await catalog.deactivate(client, 7);
      expect(client.delegate.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { isActive: false },
      });
    });

    it("answers whether the row is referenced, and counts the active ones", async () => {
      await expect(isRowReferenced(catalog, mockClient(key, { usedIds: [] }), 1)).resolves.toBe(
        false,
      );
      await expect(isRowReferenced(catalog, mockClient(key, { usedIds: [1] }), 1)).resolves.toBe(
        true,
      );
      // A row nobody points at stays deletable even when OTHER rows are in use.
      await expect(isRowReferenced(catalog, mockClient(key, { usedIds: [4] }), 1)).resolves.toBe(
        false,
      );
      // An unset optional FK is not a reference to anything — a NULL must never make row 1 look used.
      await expect(isRowReferenced(catalog, mockClient(key, { usedIds: [null] }), 1)).resolves.toBe(
        false,
      );
      await expect(catalog.countActive(mockClient(key, { count: 5 }))).resolves.toBe(5);
    });

    it("reads the used ids for the WHOLE catalog in one pass", async () => {
      // One `GROUP BY` per relation answers for every row — the list must never cost a query per row.
      const client = mockClient(key, { usedIds: [2, 2, null, 7] });
      await expect(referencedIdsOf(catalog, client)).resolves.toEqual(new Set([2, 7]));
      expect(client.referencing.groupBy).toHaveBeenCalledTimes(catalog.referencedBy.length);
    });
  });
});

describe("catalog extras", () => {
  it("event types carry their lead hours through every door", async () => {
    const client = mockClient("event-types");
    const catalog = PREFERENCE_CATALOGS["event-types"];
    expect((await catalog.list(client))[0]).toMatchObject({ minLeadHours: 24 });
    expect(await catalog.find(client, 1)).toMatchObject({ minLeadHours: 24 });
    await catalog.create(client, body);
    expect(client.delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minLeadHours: 48 }) }),
    );
    await catalog.update(client, 1, body);
    expect(client.delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minLeadHours: 48 }) }),
    );
  });

  it("event types omit the lead hours when the body has none (the column keeps its default)", async () => {
    const client = mockClient("event-types");
    await PREFERENCE_CATALOGS["event-types"].create(client, {
      name: "Boda",
      description: undefined,
      isActive: true,
    });
    expect(client.delegate.create.mock.calls[0]?.[0].data).not.toHaveProperty("minLeadHours");
    await PREFERENCE_CATALOGS["event-types"].update(client, 1, {
      name: "Boda",
      description: undefined,
      isActive: true,
    });
    expect(client.delegate.update.mock.calls[0]?.[0].data).not.toHaveProperty("minLeadHours");
  });

  it("zones convert a Decimal fee to a number and OMIT an unconfigured one", async () => {
    const client = mockClient("zones");
    const catalog = PREFERENCE_CATALOGS["zones"];
    expect((await catalog.list(client))[0]).toMatchObject({ deliveryFee: 50, municipalityId: 4 });

    // "Not configured" must stay ABSENT rather than becoming 0 — free delivery is a different answer.
    const unset = mockClient("zones");
    unset.delegate.findMany.mockResolvedValue([row(1, { deliveryFee: null, municipalityId: 4 })]);
    unset.delegate.findUnique.mockResolvedValue(row(1, { deliveryFee: null, municipalityId: 4 }));
    unset.delegate.create.mockResolvedValue(row(9, { deliveryFee: null, municipalityId: 4 }));
    unset.delegate.update.mockResolvedValue(row(1, { deliveryFee: null, municipalityId: 4 }));
    expect((await catalog.list(unset))[0]).not.toHaveProperty("deliveryFee");
    expect(await catalog.find(unset, 1)).not.toHaveProperty("deliveryFee");
    expect(await catalog.create(unset, { ...body, deliveryFee: null })).not.toHaveProperty(
      "deliveryFee",
    );
    expect(await catalog.update(unset, 1, { ...body, deliveryFee: null })).not.toHaveProperty(
      "deliveryFee",
    );
  });

  it("a zone update leaves its municipality alone when the body omits it", async () => {
    const client = mockClient("zones");
    await PREFERENCE_CATALOGS["zones"].update(client, 1, {
      name: "Zona 1",
      description: undefined,
      isActive: true,
    });
    expect(client.delegate.update.mock.calls[0]?.[0].data).not.toHaveProperty("municipalityId");
  });

  it("zones find a missing row as null", async () => {
    await expect(
      PREFERENCE_CATALOGS["zones"].find(mockClient("zones", { found: null }), 99),
    ).resolves.toBeNull();
  });
});
