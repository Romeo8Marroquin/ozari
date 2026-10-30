/* eslint-disable no-console -- local ops script: the console report IS its product */
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Catalog MERGE between two environments (owner 2026-10-27) — copies products, their details and
 * their photos from a SOURCE environment into a TARGET one, skipping every product the target
 * already has. A LOCAL ops script, never deployed (it lives outside `src/`, like
 * `reconcile:images`). English-only output: local telemetry, not user-facing copy.
 *
 * Run it through the wrapper, which loads both environments' credentials from
 * `infrastructure/secrets/` (the owner's machine) without ever printing them:
 *
 *   ./infrastructure/scripts/sync-products.ps1 staging prod          # DRY RUN — the plan only
 *   ./infrastructure/scripts/sync-products.ps1 staging prod -Apply   # copy for real
 *
 * WHAT "THE SAME PRODUCT" MEANS: the same NAME (case-, accent-, spacing- and punctuation-
 * insensitive — "CAMINO DE MESA -NUDE-" = "Camino de mesa nude") of the same BUSINESS TYPE
 * (Alquiler/Venta), among the target's ACTIVE products. A match is never touched — the merge only
 * ADDS; it reports where a matched product differs so the owner can fix it by hand, on purpose.
 *
 * VARIATIONS (2026-10-29, EPIC-1-INVENTORY): inside a matched pair, options and values match by
 * normalized name (case-, accent- and spacing-insensitive — the API's own uniqueness rule) and a
 * variant matches by its sorted normalized `option=value` pairs ("color=rojo|tamano=grande"). Every
 * variation difference (an option/value/variant missing on either side; a matched variant's stock,
 * override prices, description or default flag; the number of variation photos) is REPORTED under
 * the product's DIFFERS line — never applied.
 *
 * WHAT IS COPIED, per new product: every scalar column of `products` (read from the generated Prisma
 * enum, so a column added later is carried with no change here — a new FOREIGN KEY stops the run
 * until it is mapped below; `quantity` copies as-is, 0 for a product with variations), its details,
 * its SHOWCASE photos, and its whole variation structure: options → values → each value's photos →
 * its ACTIVE variants (tombstones are the source's history, not stock) with their override columns,
 * stock, default flag and value links; `combination_key` is rebuilt from the TARGET's value ids.
 * Every photo set (the showcase and each value's) gets exactly one primary — the flagged photo, else
 * the first. The environments share NOTHING:
 *   - lookup ids are re-resolved BY NAME in the target (currency by ISO code). Categories and detail
 *     types are admin-managed catalogs, so a missing one is CREATED; business types and rent units
 *     are seeded and never manageable, so a missing one is an error (the target was never seeded);
 *   - every photo is DOWNLOADED from the source bucket and UPLOADED to the target bucket under a new
 *     `products/<uuid>.<ext>` key, and its URL is built from the TARGET's public base — never the
 *     source's, which would make production render images served by staging;
 *   - `display_order` keeps the SOURCE's visible order, placed after whatever the target already
 *     arranged; `created_at` is preserved (the "newest" sort stays truthful).
 *
 * SAFETY:
 *  - dry run by default; `--apply` writes. Re-running is idempotent (matches are skipped).
 *  - each product is ONE transaction (row + details + every photo set + options/values/variants).
 *    Its photos are uploaded first; if the transaction fails they are deleted again (best-effort — a leftover is what `reconcile:images`
 *    sweeps). A failure stops only that product; the summary lists it, and a re-run resumes.
 *  - the source is only ever READ.
 *
 * Env (set by the wrapper): SYNC_{SOURCE,TARGET}_{LABEL,DATABASE_URL,R2_ENDPOINT,R2_BUCKET,
 * R2_PUBLIC_URL,R2_ACCESS_KEY,R2_SECRET_KEY}.
 *
 * Exit codes: 0 = nothing to copy, or everything applied · 1 = dry run with products to copy ·
 * 2 = an error (config, lookups, or any product that failed).
 */

const PRODUCT_KEY_PREFIX = "products";

/** The FOREIGN KEYS of `products` this script knows how to re-resolve. Anything else ending in
 *  `Id` is a new relation the merge cannot guess — the run stops instead of copying a raw id. */
const MAPPED_FOREIGN_KEYS = new Set([
  "productBusinessTypeId",
  "productCategoryId",
  "currencyId",
  "rentTimeUnitId",
]);

/** Scalars that are the TARGET's to decide, never copied. */
const NOT_COPIED = new Set(["id", "isActive", "updatedAt", "displayOrder"]);

interface EnvSide {
  label: string;
  prisma: PrismaClient;
  s3: S3Client;
  bucket: string;
  publicUrl: string;
}

interface Lookup {
  id: number;
  name: string;
  isActive: boolean;
}

const sourceInclude = {
  businessType: { select: { name: true } },
  category: { select: { name: true, description: true, isActive: true } },
  currency: { select: { iso4217Code: true } },
  rentTimeUnit: { select: { name: true } },
  productDetails: {
    orderBy: [{ id: "asc" }],
    select: { detail: true, detailType: { select: { name: true, description: true } } },
  },
  // The SHOWCASE set only — each option value's photos arrive under `options` below.
  productImages: {
    where: { optionValueId: null },
    orderBy: [{ sortOrder: "asc" }],
    select: { r2Key: true, isPrimary: true, sortOrder: true },
  },
  options: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      name: true,
      values: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          images: {
            orderBy: [{ sortOrder: "asc" }],
            select: { r2Key: true, isPrimary: true, sortOrder: true },
          },
        },
      },
    },
  },
  // ACTIVE variants only: a tombstone is the source's order history, nothing the target should sell.
  variants: {
    where: { isActive: true },
    orderBy: [{ id: "asc" }],
    select: {
      rentPrice: true,
      sellPrice: true,
      replacementPrice: true,
      securityDeposit: true,
      description: true,
      quantity: true,
      isDefault: true,
      values: { select: { optionValueId: true } },
    },
  },
} satisfies Prisma.ProductInclude;

type SourceProduct = Prisma.ProductGetPayload<{ include: typeof sourceInclude }>;
type SourceImage = SourceProduct["productImages"][number];
type SourceVariant = SourceProduct["variants"][number];

/** A photo as written to the target (new key, the target's own URL). */
interface CopiedImage {
  r2Key: string;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface PlannedProduct {
  source: SourceProduct;
  displayOrder: number;
}

interface Report {
  toCopy: PlannedProduct[];
  matched: { name: string; differences: string[] }[];
  duplicatesInSource: string[];
  categoriesToCreate: string[];
  detailTypesToCreate: string[];
  warnings: string[];
  copied: number;
  imagesCopied: number;
  failures: string[];
}

// ── Configuration ────────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Run this through infrastructure/scripts/sync-products.ps1.`);
  }
  return value;
}

function connect(side: "SOURCE" | "TARGET"): EnvSide {
  const env = (key: string): string => requireEnv(`SYNC_${side}_${key}`);
  return {
    label: env("LABEL"),
    prisma: new PrismaClient({
      adapter: new PrismaPg({ connectionString: env("DATABASE_URL") }),
      log: ["error"],
    }),
    s3: new S3Client({
      region: "auto",
      endpoint: env("R2_ENDPOINT"),
      // Same two LOAD-BEARING settings as `src/helpers/storage.ts`: path-style addressing, and
      // checksums only when required (R2 rejects the SDK's default CRC on PutObject otherwise).
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env("R2_ACCESS_KEY"),
        secretAccessKey: env("R2_SECRET_KEY"),
      },
    }),
    bucket: env("R2_BUCKET"),
    publicUrl: env("R2_PUBLIC_URL").replace(/\/+$/, ""),
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────

/** Case-, accent-, spacing- and punctuation-insensitive form of a name — the identity of a row. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

const productKey = (name: string, businessType: string): string =>
  `${normalizeName(name)}|${normalizeName(businessType)}`;

/**
 * What "the same option/value" means — a MIRROR of `normalizeVariationName`
 * (src/modules/products/products.variations.ts: case-, accent- and spacing-insensitive, the rule the
 * API's uniqueness check uses). Mirrored, not imported: this script stays self-contained (that module
 * pulls in `appConfig`); change both together.
 */
function normalizeVariationName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every value of a product by its id, with its option's name — the variant reader's index. */
function valueIndex(product: SourceProduct): Map<number, { option: string; value: string }> {
  return new Map(
    product.options.flatMap((option) =>
      option.values.map((value) => [value.id, { option: option.name, value: value.name }]),
    ),
  );
}

/**
 * A variant's environment-independent identity: its sorted normalized `option=value` pairs
 * ("color=rojo|tamano=grande" — ids differ between environments, names do not).
 */
function variantSignature(
  variant: SourceVariant,
  values: ReadonlyMap<number, { option: string; value: string }>,
): string {
  return variant.values
    .map(({ optionValueId }) => {
      const found = values.get(optionValueId);
      return found
        ? `${normalizeVariationName(found.option)}=${normalizeVariationName(found.value)}`
        : `?=${optionValueId}`;
    })
    .sort()
    .join("|");
}

/** "Rojo · Grande" — the variant's values in option order, for the report. */
function variantLabel(
  variant: SourceVariant,
  values: ReadonlyMap<number, { option: string; value: string }>,
): string {
  const order = [...values.keys()];
  return [...variant.values]
    .sort((a, b) => order.indexOf(a.optionValueId) - order.indexOf(b.optionValueId))
    .map(({ optionValueId }) => values.get(optionValueId)?.value ?? `#${optionValueId}`)
    .join(" · ");
}

/** Photos across every value set of a product. */
const valuePhotoCount = (product: SourceProduct): number =>
  product.options.reduce(
    (sum, option) => sum + option.values.reduce((inner, value) => inner + value.images.length, 0),
    0,
  );

/**
 * What differs in the VARIATIONS of a matched pair — options, values (per matched option) and
 * variants (by signature; for a matched variant its stock, override columns and description).
 * Reported, never applied: a matched product is the target's own.
 */
function describeVariationDifferences(source: SourceProduct, target: SourceProduct): string[] {
  const differences = [
    ...describeOptionDifferences(source, target),
    ...describeVariantDifferences(source, target),
  ];
  const sourceValuePhotos = valuePhotoCount(source);
  const targetValuePhotos = valuePhotoCount(target);
  if (sourceValuePhotos !== targetValuePhotos) {
    differences.push(`variation photos: ${targetValuePhotos} → ${sourceValuePhotos}`);
  }
  return differences;
}

/**
 * Pairs two lists by an identity key: what only the source has, what only the target has, and the
 * matched pairs (the first target row per key).
 */
function pairBy<T>(
  source: readonly T[],
  target: readonly T[],
  keyOf: (row: T) => string,
): { onlySource: T[]; onlyTarget: T[]; pairs: [T, T][] } {
  const targetByKey = new Map(target.map((row) => [keyOf(row), row]));
  const sourceKeys = new Set(source.map(keyOf));
  const onlySource: T[] = [];
  const pairs: [T, T][] = [];
  for (const row of source) {
    const twin = targetByKey.get(keyOf(row));
    if (twin) {
      pairs.push([row, twin]);
    } else {
      onlySource.push(row);
    }
  }
  return { onlySource, onlyTarget: target.filter((row) => !sourceKeys.has(keyOf(row))), pairs };
}

/** Options missing on either side, and values missing on either side of each matched option. */
function describeOptionDifferences(source: SourceProduct, target: SourceProduct): string[] {
  const nameKey = (row: { name: string }): string => normalizeVariationName(row.name);
  const options = pairBy(source.options, target.options, nameKey);
  return [
    ...options.onlySource.map((option) => `option "${option.name}": missing in target`),
    ...options.onlyTarget.map((option) => `option "${option.name}": only in target`),
    ...options.pairs.flatMap(([option, twin]) => {
      const values = pairBy(option.values, twin.values, nameKey);
      return [
        ...values.onlySource.map((value) => `value "${option.name}: ${value.name}": missing in target`),
        ...values.onlyTarget.map((value) => `value "${twin.name}: ${value.name}": only in target`),
      ];
    }),
  ];
}

/** Variants missing on either side (by signature), and what differs in each matched variant. */
function describeVariantDifferences(source: SourceProduct, target: SourceProduct): string[] {
  const sourceValues = valueIndex(source);
  const targetValues = valueIndex(target);
  const tagged = (product: SourceProduct, values: typeof sourceValues) =>
    product.variants.map((variant) => ({
      variant,
      signature: variantSignature(variant, values),
      label: variantLabel(variant, values),
    }));
  const variants = pairBy(
    tagged(source, sourceValues),
    tagged(target, targetValues),
    (row) => row.signature,
  );
  return [
    ...variants.onlySource.map((row) => `variant "${row.label}": missing in target`),
    ...variants.onlyTarget.map((row) => `variant "${row.label}": only in target`),
    ...variants.pairs.flatMap(([row, twin]) => {
      const changes = variantFieldChanges(row.variant, twin.variant);
      return changes.length > 0 ? [`variant "${row.label}": ${changes.join(", ")}`] : [];
    }),
  ];
}

/** A matched variant's differing stock / override columns / description / default flag. */
function variantFieldChanges(variant: SourceVariant, twin: SourceVariant): string[] {
  const changes: string[] = [];
  if (variant.quantity !== twin.quantity) {
    changes.push(`quantity ${twin.quantity} → ${variant.quantity}`);
  }
  for (const field of ["rentPrice", "sellPrice", "replacementPrice", "securityDeposit"] as const) {
    if (money(variant[field]) !== money(twin[field])) {
      changes.push(`${field} ${money(twin[field])} → ${money(variant[field])}`);
    }
  }
  if ((variant.description ?? "") !== (twin.description ?? "")) {
    changes.push("description");
  }
  if (variant.isDefault !== twin.isDefault) {
    changes.push(`isDefault ${String(twin.isDefault)} → ${String(variant.isDefault)}`);
  }
  return changes;
}

const money = (value: Prisma.Decimal | null): string => (value === null ? "—" : value.toFixed(2));

/** The copyable scalar columns of `products`, straight from the generated client. */
function copyableScalars(): string[] {
  const fields = Object.values(Prisma.ProductScalarFieldEnum) as string[];
  const unmapped = fields.filter(
    (field) => field.endsWith("Id") && field !== "id" && !MAPPED_FOREIGN_KEYS.has(field),
  );
  if (unmapped.length > 0) {
    throw new Error(
      `products has foreign key(s) this script does not map: ${unmapped.join(", ")}. ` +
        "Teach scripts/sync-products.ts how to resolve them in the target before syncing.",
    );
  }
  return fields.filter((field) => !NOT_COPIED.has(field) && !MAPPED_FOREIGN_KEYS.has(field));
}

/** What differs between a source product and its target twin — reported, never applied. */
function describeDifferences(
  source: SourceProduct,
  target: SourceProduct,
  scalars: readonly string[],
): string[] {
  const differences: string[] = [];
  const sourceRecord = source as unknown as Record<string, unknown>;
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const field of scalars) {
    if (field === "createdAt" || field === "name") {
      continue;
    }
    const a = sourceRecord[field];
    const b = targetRecord[field];
    const same =
      a instanceof Prisma.Decimal || b instanceof Prisma.Decimal
        ? money(a as Prisma.Decimal | null) === money(b as Prisma.Decimal | null)
        : a === b;
    if (!same) {
      differences.push(`${field}: ${String(b ?? "—")} → ${String(a ?? "—")}`);
    }
  }
  if (normalizeName(source.category.name) !== normalizeName(target.category.name)) {
    differences.push(`category: ${target.category.name} → ${source.category.name}`);
  }
  if (source.productImages.length !== target.productImages.length) {
    differences.push(`photos: ${target.productImages.length} → ${source.productImages.length}`);
  }
  if (source.productDetails.length !== target.productDetails.length) {
    differences.push(`details: ${target.productDetails.length} → ${source.productDetails.length}`);
  }
  differences.push(...describeVariationDifferences(source, target));
  return differences;
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────

const byName = (rows: Lookup[]): Map<string, Lookup> =>
  new Map(rows.map((row) => [normalizeName(row.name), row]));

async function loadCatalog(prisma: PrismaClient) {
  return prisma.product.findMany({
    where: { isActive: true },
    // The grid's own default order, so the copy reproduces what the owner SEES in the source.
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    include: sourceInclude,
  });
}

async function plan(source: EnvSide, target: EnvSide, scalars: readonly string[]): Promise<Report> {
  const report: Report = {
    toCopy: [],
    matched: [],
    duplicatesInSource: [],
    categoriesToCreate: [],
    detailTypesToCreate: [],
    warnings: [],
    copied: 0,
    imagesCopied: 0,
    failures: [],
  };

  const [sourceProducts, targetProducts, targetMax] = await Promise.all([
    loadCatalog(source.prisma),
    loadCatalog(target.prisma),
    target.prisma.product.aggregate({ _max: { displayOrder: true } }),
  ]);
  console.log(`${source.label}: ${sourceProducts.length} active products`);
  console.log(`${target.label}: ${targetProducts.length} active products`);

  const targetByKey = new Map(
    targetProducts.map((product) => [productKey(product.name, product.businessType.name), product]),
  );
  const seen = new Set<string>();
  // Copied products land AFTER whatever the target already arranged, in the source's visible order.
  let nextPosition = (targetMax._max.displayOrder ?? 0) + 1;

  for (const product of sourceProducts) {
    const key = productKey(product.name, product.businessType.name);
    if (seen.has(key)) {
      report.duplicatesInSource.push(product.name);
      continue;
    }
    seen.add(key);
    const twin = targetByKey.get(key);
    if (twin) {
      report.matched.push({
        name: product.name,
        differences: describeDifferences(product, twin, scalars),
      });
      continue;
    }
    report.toCopy.push({ source: product, displayOrder: nextPosition });
    nextPosition += 1;
  }

  // Lookups the copied products need in the target.
  const [categories, detailTypes] = await Promise.all([
    target.prisma.productCategory.findMany({ select: { id: true, name: true, isActive: true } }),
    target.prisma.productDetailType.findMany({ select: { id: true, name: true, isActive: true } }),
  ]);
  const targetCategories = byName(categories);
  const targetDetailTypes = byName(detailTypes);
  const missingCategories = new Set<string>();
  const missingDetailTypes = new Set<string>();
  for (const { source: product } of report.toCopy) {
    const category = targetCategories.get(normalizeName(product.category.name));
    if (!category) {
      missingCategories.add(product.category.name);
    } else if (!category.isActive) {
      report.warnings.push(
        `category "${category.name}" is UNPUBLISHED in ${target.label} — "${product.name}" will ` +
          "be copied but hidden from the grid until it is published (Preferencias → Productos).",
      );
    }
    for (const detail of product.productDetails) {
      if (!targetDetailTypes.has(normalizeName(detail.detailType.name))) {
        missingDetailTypes.add(detail.detailType.name);
      }
    }
  }
  report.categoriesToCreate = [...missingCategories];
  report.detailTypesToCreate = [...missingDetailTypes];
  return report;
}

function printPlan(report: Report, source: EnvSide, target: EnvSide): void {
  console.log(`\nTo COPY ${source.label} → ${target.label} — ${report.toCopy.length}:`);
  for (const { source: product, displayOrder } of report.toCopy) {
    const variations =
      product.options.length > 0
        ? `${product.options.length} option(s), ${product.variants.length} variant(s), ` +
          `${valuePhotoCount(product)} variation photo(s), `
        : "";
    console.log(
      `  + ${product.name}  [${product.businessType.name} · ${product.category.name}]  ` +
        `${product.productImages.length} photo(s), ${product.productDetails.length} detail(s), ` +
        `${variations}position ${displayOrder}`,
    );
  }
  if (report.matched.length > 0) {
    console.log(`\nAlready in ${target.label} (skipped, never modified) — ${report.matched.length}:`);
    for (const match of report.matched) {
      const note = match.differences.length > 0 ? `  DIFFERS: ${match.differences.join("; ")}` : "";
      console.log(`  = ${match.name}${note}`);
    }
  }
  if (report.duplicatesInSource.length > 0) {
    console.log(
      `\nSame name twice in ${source.label} (only the first is considered) — ` +
        `${report.duplicatesInSource.join(", ")}`,
    );
  }
  if (report.categoriesToCreate.length > 0) {
    console.log(`\nCategories to create in ${target.label}: ${report.categoriesToCreate.join(", ")}`);
  }
  if (report.detailTypesToCreate.length > 0) {
    console.log(
      `Detail types to create in ${target.label}: ${report.detailTypesToCreate.join(", ")}`,
    );
  }
  for (const warning of report.warnings) {
    console.log(`  ! ${warning}`);
  }
}

// ── Apply ────────────────────────────────────────────────────────────────────────────────────────

/** The target id for a resolved lookup — `resolveLookups` guarantees presence, so a miss is a bug. */
function idOf(map: Map<string, Lookup | number>, name: string): number {
  const found = map.get(map.has(name) ? name : normalizeName(name));
  if (found === undefined) {
    throw new Error(`Unresolved lookup "${name}" in the target`);
  }
  return typeof found === "number" ? found : found.id;
}

/** Resolve a lookup by name (creating admin-managed ones), cached for the run. */
async function resolveLookups(
  report: Report,
  source: EnvSide,
  target: EnvSide,
): Promise<{
  businessTypes: Map<string, Lookup>;
  categories: Map<string, Lookup>;
  currencies: Map<string, number>;
  rentTimeUnits: Map<string, Lookup>;
  detailTypes: Map<string, Lookup>;
}> {
  const lookupSelect = { id: true, name: true, isActive: true } as const;
  const [businessTypes, categories, currencies, rentTimeUnits, detailTypes] = await Promise.all([
    target.prisma.productBusinessType.findMany({ select: lookupSelect }),
    target.prisma.productCategory.findMany({ select: lookupSelect }),
    target.prisma.currency.findMany({ select: { id: true, iso4217Code: true } }),
    target.prisma.rentTimeUnit.findMany({ select: lookupSelect }),
    target.prisma.productDetailType.findMany({ select: lookupSelect }),
  ]);
  const resolved = {
    businessTypes: byName(businessTypes),
    categories: byName(categories),
    currencies: new Map(currencies.map((row) => [row.iso4217Code.toUpperCase(), row.id])),
    rentTimeUnits: byName(rentTimeUnits),
    detailTypes: byName(detailTypes),
  };

  // The admin-managed catalogs a copied product needs, created with the SOURCE's own wording.
  for (const name of report.categoriesToCreate) {
    const original = report.toCopy.find(
      (item) => normalizeName(item.source.category.name) === normalizeName(name),
    )?.source.category;
    // eslint-disable-next-line no-await-in-loop -- a handful of rows, sequential for clear logs
    const created = await target.prisma.productCategory.create({
      data: { name, description: original?.description ?? null, isActive: true },
      select: lookupSelect,
    });
    resolved.categories.set(normalizeName(name), created);
    console.log(`  created category "${name}" in ${target.label}`);
  }
  for (const name of report.detailTypesToCreate) {
    const original = report.toCopy
      .flatMap((item) => item.source.productDetails)
      .find((detail) => normalizeName(detail.detailType.name) === normalizeName(name))?.detailType;
    // eslint-disable-next-line no-await-in-loop -- a handful of rows, sequential for clear logs
    const created = await target.prisma.productDetailType.create({
      data: { name, description: original?.description ?? null, isActive: true },
      select: lookupSelect,
    });
    resolved.detailTypes.set(normalizeName(name), created);
    console.log(`  created detail type "${name}" in ${target.label}`);
  }

  // Seeded, never-manageable lookups must already exist — a miss means the target was never seeded.
  const missing: string[] = [];
  for (const { source: product } of report.toCopy) {
    if (!resolved.businessTypes.has(normalizeName(product.businessType.name))) {
      missing.push(`business type "${product.businessType.name}"`);
    }
    if (!resolved.currencies.has(product.currency.iso4217Code.toUpperCase())) {
      missing.push(`currency ${product.currency.iso4217Code}`);
    }
    if (product.rentTimeUnit && !resolved.rentTimeUnits.has(normalizeName(product.rentTimeUnit.name))) {
      missing.push(`rent time unit "${product.rentTimeUnit.name}"`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${target.label} lacks seeded lookups: ${[...new Set(missing)].join(", ")}. ` +
        `Run ./infrastructure/scripts/db-seed.ps1 for it, then re-run (${source.label} untouched).`,
    );
  }
  return resolved;
}

/** What every photo copy of one product shares. `uploaded` collects each key AS IT LANDS in the
 *  target, so a failure later in the product still rolls back what was already uploaded. */
interface CopyContext {
  source: EnvSide;
  target: EnvSide;
  report: Report;
  uploaded: string[];
}

/** Download ONE photo set (the showcase, or one option value's) from the source and upload it to
 *  the target under new keys. */
async function copyImageSet(
  product: SourceProduct,
  images: readonly SourceImage[],
  { source, target, report, uploaded }: CopyContext,
): Promise<CopiedImage[]> {
  const copied: CopiedImage[] = [];
  for (const image of images) {
    // eslint-disable-next-line no-await-in-loop -- ≤ 150 photos per product; sequential keeps memory flat
    const object = await source.s3
      .send(new GetObjectCommand({ Bucket: source.bucket, Key: image.r2Key }))
      .catch((error: unknown) => {
        report.warnings.push(
          `"${product.name}": photo ${image.r2Key} is missing from ${source.label}'s bucket ` +
            `(${String(error)}) — copied without it.`,
        );
        return null;
      });
    if (!object?.Body) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- see above
    const bytes = await object.Body.transformToByteArray();
    const extension = image.r2Key.split(".").pop()?.toLowerCase() ?? "jpg";
    const key = `${PRODUCT_KEY_PREFIX}/${randomUUID()}.${extension}`;
    // eslint-disable-next-line no-await-in-loop -- see above
    await target.s3.send(
      new PutObjectCommand({
        Bucket: target.bucket,
        Key: key,
        Body: bytes,
        ContentType: object.ContentType ?? "application/octet-stream",
        ContentLength: bytes.byteLength,
      }),
    );
    uploaded.push(key);
    copied.push({
      r2Key: key,
      url: `${target.publicUrl}/${key}`,
      isPrimary: image.isPrimary,
      sortOrder: copied.length,
    });
  }
  // Each set has exactly one primary: the flagged one (the first flagged, should a source ever carry
  // two), else the first — the source's flagged photo may also have been the one skipped.
  const primaryIndex = Math.max(
    0,
    copied.findIndex((image) => image.isPrimary),
  );
  copied.forEach((image, index) => {
    image.isPrimary = index === primaryIndex;
  });
  return copied;
}

/** The value sets of a product, each with its copied photos — uploaded before the transaction. */
interface CopiedValueSets {
  /** source value id → its copied photos. */
  byValueId: Map<number, CopiedImage[]>;
  count: number;
}

async function copyValueImageSets(
  product: SourceProduct,
  context: CopyContext,
): Promise<CopiedValueSets> {
  const byValueId = new Map<number, CopiedImage[]>();
  let count = 0;
  for (const value of product.options.flatMap((option) => option.values)) {
    // eslint-disable-next-line no-await-in-loop -- sequential, like the showcase set
    const images = await copyImageSet(product, value.images, context);
    byValueId.set(value.id, images);
    count += images.length;
  }
  return { byValueId, count };
}

/**
 * Writes the variation structure of a copied product inside its transaction: options → values (each
 * with its photo set) → the ACTIVE variants with their override columns, stock, default flag and
 * join rows. `combinationKey` is rebuilt from the TARGET's value ids (sorted numerically, joined by
 * "." — the API's own rule), never copied: ids differ between environments.
 */
async function createVariations(
  tx: Prisma.TransactionClient,
  productId: number,
  product: SourceProduct,
  valueSets: CopiedValueSets,
): Promise<void> {
  const targetValueId = new Map<number, number>();
  for (const [optionIndex, option] of product.options.entries()) {
    // eslint-disable-next-line no-await-in-loop -- one transaction = one connection: sequential
    const createdOption = await tx.productOption.create({
      data: { productId, name: option.name, sortOrder: optionIndex },
      select: { id: true },
    });
    for (const [valueIndex, value] of option.values.entries()) {
      const images = valueSets.byValueId.get(value.id) ?? [];
      // eslint-disable-next-line no-await-in-loop -- see above
      const createdValue = await tx.productOptionValue.create({
        data: { optionId: createdOption.id, name: value.name, sortOrder: valueIndex },
        select: { id: true },
      });
      targetValueId.set(value.id, createdValue.id);
      if (images.length > 0) {
        // Value photos keep `productId` (the delete sweep and reconcile:images rely on it).
        // eslint-disable-next-line no-await-in-loop -- see above
        await tx.productImage.createMany({
          data: images.map((image) => ({ ...image, productId, optionValueId: createdValue.id })),
        });
      }
    }
  }
  for (const variant of product.variants) {
    const valueIds = variant.values.map(({ optionValueId }) => {
      const id = targetValueId.get(optionValueId);
      if (id === undefined) {
        throw new Error(`variant references value ${optionValueId}, which is not among its options`);
      }
      return id;
    });
    // eslint-disable-next-line no-await-in-loop -- see above
    await tx.productVariant.create({
      data: {
        productId,
        combinationKey: [...valueIds].sort((a, b) => a - b).join("."),
        rentPrice: variant.rentPrice,
        sellPrice: variant.sellPrice,
        replacementPrice: variant.replacementPrice,
        securityDeposit: variant.securityDeposit,
        description: variant.description,
        quantity: variant.quantity,
        isDefault: variant.isDefault,
        values: { create: valueIds.map((optionValueId) => ({ optionValueId })) },
      },
    });
  }
}

async function apply(
  report: Report,
  source: EnvSide,
  target: EnvSide,
  scalars: readonly string[],
): Promise<void> {
  console.log(`\n── Applying to ${target.label} ─────────────────────────────────`);
  const lookups = await resolveLookups(report, source, target);

  for (const { source: product, displayOrder } of report.toCopy) {
    const uploadedKeys: string[] = [];
    const context: CopyContext = { source, target, report, uploaded: uploadedKeys };
    try {
      // eslint-disable-next-line no-await-in-loop -- one product at a time: clear logs, clean rollback
      const images = await copyImageSet(product, product.productImages, context);
      // eslint-disable-next-line no-await-in-loop -- see above
      const valueSets = await copyValueImageSets(product, context);

      const record = product as unknown as Record<string, unknown>;
      const copiedScalars = Object.fromEntries(scalars.map((field) => [field, record[field]]));
      const data = {
        ...copiedScalars,
        displayOrder,
        isActive: true,
        productBusinessTypeId: idOf(lookups.businessTypes, product.businessType.name),
        productCategoryId: idOf(lookups.categories, product.category.name),
        currencyId: idOf(lookups.currencies, product.currency.iso4217Code.toUpperCase()),
        rentTimeUnitId: product.rentTimeUnit
          ? idOf(lookups.rentTimeUnits, product.rentTimeUnit.name)
          : null,
        productDetails: {
          create: product.productDetails.map((detail) => ({
            productDetailTypeId: idOf(lookups.detailTypes, detail.detailType.name),
            detail: detail.detail,
          })),
        },
        productImages: { create: images },
      } as Prisma.ProductUncheckedCreateInput;

      // ONE transaction per product: the row, its details, its showcase, and its whole variation
      // structure (options, values + their photos, variants) land together or not at all.
      // eslint-disable-next-line no-await-in-loop -- see above
      const created = await target.prisma.$transaction(async (tx) => {
        const row = await tx.product.create({ data, select: { id: true } });
        await createVariations(tx, row.id, product, valueSets);
        return row;
      });
      const photos = images.length + valueSets.count;
      report.copied += 1;
      report.imagesCopied += photos;
      const variationNote =
        product.options.length > 0
          ? `, ${product.options.length} option(s), ${product.variants.length} variant(s)`
          : "";
      console.log(`  ✓ ${product.name} → id ${created.id} (${photos} photo(s)${variationNote})`);
    } catch (error) {
      report.failures.push(`${product.name}: ${String(error)}`);
      console.error(`  ✗ ${product.name}: ${String(error)}`);
      if (uploadedKeys.length > 0) {
        // eslint-disable-next-line no-await-in-loop -- rollback of THIS product's uploads
        await target.s3
          .send(
            new DeleteObjectsCommand({
              Bucket: target.bucket,
              Delete: { Objects: uploadedKeys.map((Key) => ({ Key })), Quiet: true },
            }),
          )
          .catch(() => {
            console.error(
              `    ! could not remove its ${uploadedKeys.length} uploaded photo(s) — ` +
                `run reconcile:images on ${target.label} to sweep them.`,
            );
          });
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const doApply = process.argv.slice(2).includes("--apply");
  const scalars = copyableScalars();
  const source = connect("SOURCE");
  const target = connect("TARGET");
  if (source.label === target.label) {
    throw new Error("Source and target are the same environment.");
  }

  console.log("── Product catalog merge ──────────────────────────────────────");
  console.log(`${source.label} → ${target.label}`);
  console.log(`Mode: ${doApply ? "APPLY (will write to the target)" : "DRY RUN (pass -Apply to copy)"}`);
  console.log(`Copied columns: ${scalars.join(", ")}`);

  try {
    let report: Report;
    try {
      report = await plan(source, target, scalars);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
        throw new Error(
          `A column this code expects is missing in one database (${String(error.meta?.["column"] ?? "?")}). ` +
            "Both environments must run the SAME migrations as this checkout — deploy first.",
          { cause: error },
        );
      }
      throw error;
    }
    printPlan(report, source, target);

    if (report.toCopy.length === 0) {
      console.log(`\nResult: NOTHING TO COPY — ${target.label} already has every product.`);
      return 0;
    }
    if (!doApply) {
      console.log(`\nResult: ${report.toCopy.length} product(s) would be copied. Re-run with -Apply.`);
      return 1;
    }

    await apply(report, source, target, scalars);

    console.log("\n── Summary ─────────────────────────────────────────────────────");
    console.log(`  Products copied:  ${report.copied}/${report.toCopy.length}`);
    console.log(`  Photos copied:    ${report.imagesCopied}`);
    console.log(`  Skipped (exist):  ${report.matched.length}`);
    console.log(`  Failures:         ${report.failures.length}`);
    for (const warning of report.warnings) {
      console.log(`  ! ${warning}`);
    }
    if (report.failures.length > 0) {
      console.error("Result: COMPLETED WITH FAILURES — fix the cause and re-run (copied ones are skipped).");
      return 2;
    }
    console.log("Result: DONE — re-run without -Apply to confirm there is nothing left to copy.");
    return 0;
  } finally {
    await Promise.all([source.prisma.$disconnect(), target.prisma.$disconnect()]);
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("Sync FAILED:", error instanceof Error ? error.message : error);
    process.exit(2);
  });
