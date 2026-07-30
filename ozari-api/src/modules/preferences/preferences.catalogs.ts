import { Prisma } from "@prisma/client";
import type {
  CatalogRowRequestModel,
  PreferenceCatalogRowModel,
} from "./preferences.models.js";

/**
 * THE CATALOG REGISTRY — the admin-manageable seeded lookups, and the ONLY list of them.
 *
 * Six tables with the same life story (name, optional description, a publication flag, sometimes one
 * extra field) get one set of endpoints instead of six near-identical CRUD modules. Adding a catalog
 * later is ONE entry here: no route, no controller, no validator change.
 *
 * **What is deliberately absent is the important part.** `product_business_types` (`RENT`/`SELL`),
 * `rent_time_units` (the billing engine only prices Día/Evento), `payment_status`, `user_roles`,
 * `token_types`, `user_phone_types`, `currencies` and the geo tables are NOT here and must never be:
 * runtime code branches on their ids, so an admin deleting "Alquiler" would break pricing, and one
 * adding a rent unit would create products the validator refuses. Their names are surfaced read-only
 * where a form needs a label; they are never rows you can add or remove.
 *
 * Each entry owns its Prisma work as CLOSURES rather than a model name + generic query builder: the
 * delegates have different field shapes, and closures keep every query type-checked at the call site
 * instead of casting through `any`.
 */

/** The Prisma surface a catalog needs — satisfied by both the client and a transaction client. */
export type CatalogClient = Pick<
  Prisma.TransactionClient,
  | "eventType"
  | "contactType"
  | "zone"
  | "paymentMethod"
  | "productCategory"
  | "productDetailType"
  | "municipality"
  | "service"
  | "clientRegistry"
  | "clientRegistryContact"
  | "clientRegistryAddress"
  | "address"
  | "product"
  | "productDetail"
>;

/**
 * How an extra field is parsed. A discriminated union rather than one shape with optional bounds:
 * an `int` field is ALWAYS bounded (an unbounded lead time is not a thing anyone wants), and saying
 * so in the type means the parser has no "what if there's no maximum" branch to get wrong.
 * `money` accepts a nullable decimal; `ref` is an id that must exist and be published elsewhere.
 */
export type CatalogFieldDefinition =
  | { name: keyof CatalogRowRequestModel; kind: "int"; min: number; max: number }
  | { name: keyof CatalogRowRequestModel; kind: "money" | "ref" };

export interface CatalogDefinition {
  /** The fields BEYOND `name`/`description`/`isActive`, which every catalog has. */
  extraFields: CatalogFieldDefinition[];
  /**
   * The smallest number of ACTIVE rows the system can function with. Event types, contact types and
   * product categories are required by the order/product forms — emptying one doesn't just look odd,
   * it puts those forms into their `config` dead-end. Zones, payment methods and detail types are
   * genuinely optional (0 is a valid configuration), so they carry 0.
   */
  minimumActive: number;
  list(client: CatalogClient): Promise<PreferenceCatalogRowModel[]>;
  find(client: CatalogClient, id: number): Promise<PreferenceCatalogRowModel | null>;
  create(
    client: CatalogClient,
    data: CatalogRowRequestModel,
  ): Promise<PreferenceCatalogRowModel>;
  update(
    client: CatalogClient,
    id: number,
    data: CatalogRowRequestModel,
  ): Promise<PreferenceCatalogRowModel>;
  remove(client: CatalogClient, id: number): Promise<void>;
  deactivate(client: CatalogClient, id: number): Promise<void>;
  /**
   * Every foreign key that can point AT a row of this catalog, each reading the ids currently in
   * use — a `GROUP BY` on the indexed column, so one query answers for the whole catalog rather than
   * one count per row.
   *
   * ONE declaration, two consumers: the list's `isReferenced` flags (so the delete dialog can name
   * the outcome up front) and the delete decision itself (delete vs deactivate). They cannot disagree,
   * which a second `isReferenced(id)` closure would eventually allow.
   */
  referencedBy: Array<(client: CatalogClient) => Promise<Array<number | null>>>;
  countActive(client: CatalogClient): Promise<number>;
}

/** The columns every catalog shares — selected identically so `list` bodies stay one line. */
const BASE_SELECT = { id: true, name: true, description: true, isActive: true } as const;
const BY_NAME = [{ isActive: "desc" as const }, { name: "asc" as const }];

/** A raw row → the uniform response shape (Prisma's `null` description becomes absent). */
const toRow = (row: {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
}): PreferenceCatalogRowModel => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  isActive: row.isActive,
});

/** The three fields every catalog writes, from a validated body. */
const baseData = (data: CatalogRowRequestModel) => ({
  name: data.name,
  description: data.description ?? null,
  isActive: data.isActive,
});

/** The set of ids something currently points at, across every relation the catalog declares. All the
 *  reads fire together — a catalog with two referencing tables costs one round-trip, not two. */
export const referencedIdsOf = async (
  catalog: CatalogDefinition,
  client: CatalogClient,
): Promise<Set<number>> => {
  const used = await Promise.all(catalog.referencedBy.map((read) => read(client)));
  return new Set(used.flat().filter((id): id is number => id !== null));
};

/** Is THIS row in use? Reads the same declaration as the list, so the preview the admin saw and the
 *  decision the delete makes can never come from two different rules. */
export const isRowReferenced = async (
  catalog: CatalogDefinition,
  client: CatalogClient,
  id: number,
): Promise<boolean> => (await referencedIdsOf(catalog, client)).has(id);

export const PREFERENCE_CATALOGS = {
  "event-types": {
    extraFields: [{ name: "minLeadHours", kind: "int", min: 0, max: 24 * 365 }],
    // The order form cannot be filled without one.
    minimumActive: 1,
    list: async (client) =>
      (
        await client.eventType.findMany({
          select: { ...BASE_SELECT, minLeadHours: true },
          orderBy: BY_NAME,
        })
      ).map((row) => ({ ...toRow(row), minLeadHours: row.minLeadHours })),
    find: async (client, id) => {
      const row = await client.eventType.findUnique({
        where: { id },
        select: { ...BASE_SELECT, minLeadHours: true },
      });
      return row ? { ...toRow(row), minLeadHours: row.minLeadHours } : null;
    },
    create: async (client, data) => {
      const row = await client.eventType.create({
        data: { ...baseData(data), ...(data.minLeadHours !== undefined && { minLeadHours: data.minLeadHours }) },
        select: { ...BASE_SELECT, minLeadHours: true },
      });
      return { ...toRow(row), minLeadHours: row.minLeadHours };
    },
    update: async (client, id, data) => {
      const row = await client.eventType.update({
        where: { id },
        data: { ...baseData(data), ...(data.minLeadHours !== undefined && { minLeadHours: data.minLeadHours }) },
        select: { ...BASE_SELECT, minLeadHours: true },
      });
      return { ...toRow(row), minLeadHours: row.minLeadHours };
    },
    remove: async (client, id) => {
      await client.eventType.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.eventType.update({ where: { id }, data: { isActive: false } });
    },
    // An order snapshots nothing about its event type — it holds a live FK — so a referenced type
    // must survive as an unpublished row or the order's detail page loses its name.
    referencedBy: [
      (client) =>
        client.service
          .groupBy({ by: ["eventTypeId"] })
          .then((rows) => rows.map((row) => row.eventTypeId)),
    ],
    countActive: (client) => client.eventType.count({ where: { isActive: true } }),
  },

  "contact-types": {
    extraFields: [],
    // The client-registry form needs at least one channel to offer.
    minimumActive: 1,
    list: async (client) =>
      (await client.contactType.findMany({ select: BASE_SELECT, orderBy: BY_NAME })).map(toRow),
    find: async (client, id) => {
      const row = await client.contactType.findUnique({ where: { id }, select: BASE_SELECT });
      return row ? toRow(row) : null;
    },
    create: async (client, data) =>
      toRow(await client.contactType.create({ data: baseData(data), select: BASE_SELECT })),
    update: async (client, id, data) =>
      toRow(
        await client.contactType.update({ where: { id }, data: baseData(data), select: BASE_SELECT }),
      ),
    remove: async (client, id) => {
      await client.contactType.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.contactType.update({ where: { id }, data: { isActive: false } });
    },
    referencedBy: [
      (client) =>
        client.clientRegistryContact
          .groupBy({ by: ["contactTypeId"] })
          .then((rows) => rows.map((row) => row.contactTypeId)),
    ],
    countActive: (client) => client.contactType.count({ where: { isActive: true } }),
  },

  zones: {
    extraFields: [
      { name: "municipalityId", kind: "ref" },
      { name: "deliveryFee", kind: "money" },
    ],
    // Walk-ins are often outside every seeded zone (the address text carries the truth), so a system
    // with no zones at all is a legitimate configuration.
    minimumActive: 0,
    list: async (client) =>
      (
        await client.zone.findMany({
          select: { ...BASE_SELECT, deliveryFee: true, municipalityId: true },
          orderBy: BY_NAME,
        })
      ).map((row) => ({
        ...toRow(row),
        ...(row.deliveryFee !== null && { deliveryFee: Number(row.deliveryFee) }),
        municipalityId: row.municipalityId,
      })),
    find: async (client, id) => {
      const row = await client.zone.findUnique({
        where: { id },
        select: { ...BASE_SELECT, deliveryFee: true, municipalityId: true },
      });
      return row
        ? {
            ...toRow(row),
            ...(row.deliveryFee !== null && { deliveryFee: Number(row.deliveryFee) }),
            municipalityId: row.municipalityId,
          }
        : null;
    },
    create: async (client, data) => {
      const row = await client.zone.create({
        data: {
          ...baseData(data),
          // The validator guarantees both are present for this catalog; the fallbacks only satisfy
          // the shared request type.
          /* v8 ignore next 2 -- unreachable: `municipalityId` is required for zones */
          municipalityId: data.municipalityId ?? 0,
          deliveryFee: data.deliveryFee ?? null,
        },
        select: { ...BASE_SELECT, deliveryFee: true, municipalityId: true },
      });
      return {
        ...toRow(row),
        ...(row.deliveryFee !== null && { deliveryFee: Number(row.deliveryFee) }),
        municipalityId: row.municipalityId,
      };
    },
    update: async (client, id, data) => {
      const row = await client.zone.update({
        where: { id },
        data: {
          ...baseData(data),
          ...(data.municipalityId !== undefined && { municipalityId: data.municipalityId }),
          deliveryFee: data.deliveryFee ?? null,
        },
        select: { ...BASE_SELECT, deliveryFee: true, municipalityId: true },
      });
      return {
        ...toRow(row),
        ...(row.deliveryFee !== null && { deliveryFee: Number(row.deliveryFee) }),
        municipalityId: row.municipalityId,
      };
    },
    remove: async (client, id) => {
      await client.zone.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.zone.update({ where: { id }, data: { isActive: false } });
    },
    referencedBy: [
      (client) =>
        client.address.groupBy({ by: ["zoneId"] }).then((rows) => rows.map((row) => row.zoneId)),
      (client) =>
        client.clientRegistryAddress
          .groupBy({ by: ["zoneId"] })
          .then((rows) => rows.map((row) => row.zoneId)),
    ],
    countActive: (client) => client.zone.count({ where: { isActive: true } }),
  },

  "payment-methods": {
    extraFields: [],
    minimumActive: 0,
    list: async (client) =>
      (await client.paymentMethod.findMany({ select: BASE_SELECT, orderBy: BY_NAME })).map(toRow),
    find: async (client, id) => {
      const row = await client.paymentMethod.findUnique({ where: { id }, select: BASE_SELECT });
      return row ? toRow(row) : null;
    },
    create: async (client, data) =>
      toRow(await client.paymentMethod.create({ data: baseData(data), select: BASE_SELECT })),
    update: async (client, id, data) =>
      toRow(
        await client.paymentMethod.update({
          where: { id },
          data: baseData(data),
          select: BASE_SELECT,
        }),
      ),
    remove: async (client, id) => {
      await client.paymentMethod.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.paymentMethod.update({ where: { id }, data: { isActive: false } });
    },
    referencedBy: [
      (client) =>
        client.service
          .groupBy({ by: ["paymentMethodId"] })
          .then((rows) => rows.map((row) => row.paymentMethodId)),
      (client) =>
        client.clientRegistry
          .groupBy({ by: ["preferredPaymentMethodId"] })
          .then((rows) => rows.map((row) => row.preferredPaymentMethodId)),
    ],
    countActive: (client) => client.paymentMethod.count({ where: { isActive: true } }),
  },

  "product-categories": {
    extraFields: [],
    // A product cannot be created without a category.
    minimumActive: 1,
    list: async (client) =>
      (await client.productCategory.findMany({ select: BASE_SELECT, orderBy: BY_NAME })).map(toRow),
    find: async (client, id) => {
      const row = await client.productCategory.findUnique({ where: { id }, select: BASE_SELECT });
      return row ? toRow(row) : null;
    },
    create: async (client, data) =>
      toRow(await client.productCategory.create({ data: baseData(data), select: BASE_SELECT })),
    update: async (client, id, data) =>
      toRow(
        await client.productCategory.update({
          where: { id },
          data: baseData(data),
          select: BASE_SELECT,
        }),
      ),
    remove: async (client, id) => {
      await client.productCategory.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.productCategory.update({ where: { id }, data: { isActive: false } });
    },
    referencedBy: [
      (client) =>
        client.product
          .groupBy({ by: ["productCategoryId"] })
          .then((rows) => rows.map((row) => row.productCategoryId)),
    ],
    countActive: (client) => client.productCategory.count({ where: { isActive: true } }),
  },

  "product-detail-types": {
    extraFields: [],
    // Product details are optional, so zero types is fine.
    minimumActive: 0,
    list: async (client) =>
      (await client.productDetailType.findMany({ select: BASE_SELECT, orderBy: BY_NAME })).map(
        toRow,
      ),
    find: async (client, id) => {
      const row = await client.productDetailType.findUnique({ where: { id }, select: BASE_SELECT });
      return row ? toRow(row) : null;
    },
    create: async (client, data) =>
      toRow(await client.productDetailType.create({ data: baseData(data), select: BASE_SELECT })),
    update: async (client, id, data) =>
      toRow(
        await client.productDetailType.update({
          where: { id },
          data: baseData(data),
          select: BASE_SELECT,
        }),
      ),
    remove: async (client, id) => {
      await client.productDetailType.delete({ where: { id } });
    },
    deactivate: async (client, id) => {
      await client.productDetailType.update({ where: { id }, data: { isActive: false } });
    },
    referencedBy: [
      (client) =>
        client.productDetail
          .groupBy({ by: ["productDetailTypeId"] })
          .then((rows) => rows.map((row) => row.productDetailTypeId)),
    ],
    countActive: (client) => client.productDetailType.count({ where: { isActive: true } }),
  },
} satisfies Record<string, CatalogDefinition>;

export type CatalogKey = keyof typeof PREFERENCE_CATALOGS;

/** The url segment → its definition, or `undefined` for anything not manageable (a 404, never a
 *  crash: the URL is user input and an unlisted table must read as "no such thing here"). */
export const catalogByKey = (key: string): CatalogDefinition | undefined =>
  (PREFERENCE_CATALOGS as Record<string, CatalogDefinition>)[key];

/** The response keys, paired with their registry keys — the shape `GET /preferences` assembles. */
export const CATALOG_RESPONSE_KEYS = [
  ["eventTypes", "event-types"],
  ["contactTypes", "contact-types"],
  ["zones", "zones"],
  ["paymentMethods", "payment-methods"],
  ["productCategories", "product-categories"],
  ["productDetailTypes", "product-detail-types"],
] as const satisfies ReadonlyArray<readonly [string, CatalogKey]>;
