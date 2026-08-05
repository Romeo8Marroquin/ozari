import { Prisma } from "@prisma/client";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { decryptKms, encryptKms } from "@helpers/encryption.js";
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
  | "bankAccount"
>;

/**
 * How an extra field is parsed. A discriminated union rather than one shape with optional bounds:
 * an `int` field is ALWAYS bounded (an unbounded lead time is not a thing anyone wants), and saying
 * so in the type means the parser has no "what if there's no maximum" branch to get wrong.
 * `money` accepts a nullable decimal; `ref` is an id that must exist and be published elsewhere;
 * `text` is a bounded required string; `token` is one of a fixed list, or `null`.
 */
export type CatalogFieldDefinition =
  | { name: keyof CatalogRowRequestModel; kind: "int"; min: number; max: number }
  | { name: keyof CatalogRowRequestModel; kind: "text"; min: number; max: number }
  | { name: keyof CatalogRowRequestModel; kind: "token"; options: readonly string[] }
  | { name: keyof CatalogRowRequestModel; kind: "money" }
  // `ref` is the ONLY kind that hits the database, which is why it is its own member rather than
  // sharing one with `money`: the parser splits on exactly that line, so the four local kinds are
  // decided synchronously and nothing else pays for the one lookup.
  | { name: keyof CatalogRowRequestModel; kind: "ref" };

/**
 * The banks we ship a logo for (`ozari-app/src/assets/banks/`), and the ONLY values `bankKey`
 * accepts besides `null`.
 *
 * Validated rather than left free-form precisely because the key's whole job is to name an asset:
 * a typo'd `"banrual"` would save happily and then render nothing on the document, with no error
 * anywhere to explain why. `null` — "sin logo" — is always legal, so an account at any other bank
 * is fully usable; it simply prints as text. Mirrored on the frontend (`bankLogos.ts`): adding a
 * bank means adding the asset and BOTH lists in the same commit.
 */
export const BANK_KEYS = ["banrural", "bac"] as const;

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

const BANK_SELECT = {
  ...BASE_SELECT,
  bankKey: true,
  accountType: true,
  accountNumberKms: true,
  holderKms: true,
} as const;

/**
 * A ciphertext → its plaintext, or `""` if it cannot be read.
 *
 * TOTAL on purpose, like `decodeCoords` is for a corrupt pin: `decryptKms` throws on a truncated
 * or foreign-key ciphertext, and letting that escape would mean ONE damaged row 500s the entire
 * preferences screen — which is the exact screen an admin would go to in order to fix or delete
 * it. An unreadable account reads as blank and can be repaired; a screen that will not load can't.
 * Logged, because a value we can no longer decrypt is never routine.
 */
const readSecret = (ciphertext: string): string => {
  try {
    return decryptKms(ciphertext);
  } catch (error) {
    logger.error(i18next.t("preferences.catalogs.logs.undecryptableBankField", { error }));
    return "";
  }
};

/** A bank account row → the uniform response shape, with both secrets decrypted. */
const toBankRow = (row: {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  bankKey: string | null;
  accountType: string;
  accountNumberKms: string;
  holderKms: string;
}): PreferenceCatalogRowModel => ({
  ...toRow(row),
  bankKey: row.bankKey,
  accountType: row.accountType,
  accountNumber: readSecret(row.accountNumberKms),
  holder: readSecret(row.holderKms),
});

/** A validated bank body → the columns, encrypting the two that are PII the moment they are
 *  written. The validator guarantees all four extras are present for this catalog; the fallbacks
 *  exist only to satisfy the shared request type, which is optional-by-catalog. */
const bankData = (data: CatalogRowRequestModel) => ({
  ...baseData(data),
  bankKey: data.bankKey ?? null,
  /* v8 ignore start -- unreachable: the validator requires all three for `bank-accounts` */
  accountType: data.accountType ?? "",
  accountNumberKms: encryptKms(data.accountNumber ?? ""),
  holderKms: encryptKms(data.holder ?? ""),
  /* v8 ignore stop */
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

  "bank-accounts": {
    extraFields: [
      { name: "bankKey", kind: "token", options: BANK_KEYS },
      { name: "accountType", kind: "text", min: 2, max: 40 },
      { name: "accountNumber", kind: "text", min: 4, max: 34 },
      { name: "holder", kind: "text", min: 2, max: 120 },
    ],
    // A business that only takes cash is a real configuration, and this catalog starts EMPTY on
    // every database (unlike the others, nothing here is seeded — these are the owner's own
    // accounts, which we could not invent).
    minimumActive: 0,
    list: async (client) =>
      (
        await client.bankAccount.findMany({ select: BANK_SELECT, orderBy: BY_NAME })
      ).map(toBankRow),
    find: async (client, id) => {
      const row = await client.bankAccount.findUnique({ where: { id }, select: BANK_SELECT });
      return row ? toBankRow(row) : null;
    },
    create: async (client, data) =>
      toBankRow(
        await client.bankAccount.create({ data: bankData(data), select: BANK_SELECT }),
      ),
    update: async (client, id, data) =>
      toBankRow(
        await client.bankAccount.update({ where: { id }, data: bankData(data), select: BANK_SELECT }),
      ),
    remove: async (client, id) => {
      await client.bankAccount.delete({ where: { id } });
    },
    /* v8 ignore next 4 -- unreachable through the endpoint: `referencedBy` is empty, so a bank
       account is never referenced and the delete always takes the hard-delete door. Declared
       anyway because the interface requires it, and because the day something DOES point at an
       account this is where the answer belongs. */
    deactivate: async (client, id) => {
      await client.bankAccount.update({ where: { id }, data: { isActive: false } });
    },
    // Deliberately EMPTY. Nothing holds a foreign key to a bank account: a document that was
    // generated already carries its numbers as text, so removing an account can never orphan a
    // record. The conditional NO-TRASH rule therefore always resolves to a hard delete here.
    referencedBy: [],
    countActive: (client) => client.bankAccount.count({ where: { isActive: true } }),
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
  ["bankAccounts", "bank-accounts"],
] as const satisfies ReadonlyArray<readonly [string, CatalogKey]>;
