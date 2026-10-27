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
 * WHAT IS COPIED, per new product: every scalar column of `products` (read from the generated Prisma
 * enum, so a column added later is carried with no change here — a new FOREIGN KEY stops the run
 * until it is mapped below), its details, and its gallery. The environments share NOTHING:
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
 *  - each product is ONE transaction (row + details + images). Its photos are uploaded first; if the
 *    transaction fails they are deleted again (best-effort — a leftover is what `reconcile:images`
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
  productImages: {
    orderBy: [{ sortOrder: "asc" }],
    select: { r2Key: true, isPrimary: true, sortOrder: true },
  },
} satisfies Prisma.ProductInclude;

type SourceProduct = Prisma.ProductGetPayload<{ include: typeof sourceInclude }>;

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
    console.log(
      `  + ${product.name}  [${product.businessType.name} · ${product.category.name}]  ` +
        `${product.productImages.length} photo(s), ${product.productDetails.length} detail(s), ` +
        `position ${displayOrder}`,
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

/** Download every photo of `product` from the source and upload it to the target under new keys. */
async function copyImages(
  product: SourceProduct,
  source: EnvSide,
  target: EnvSide,
  report: Report,
): Promise<{ r2Key: string; url: string; isPrimary: boolean; sortOrder: number }[]> {
  const copied: { r2Key: string; url: string; isPrimary: boolean; sortOrder: number }[] = [];
  for (const image of product.productImages) {
    // eslint-disable-next-line no-await-in-loop -- ≤ 8 photos per product; sequential keeps memory flat
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
    copied.push({
      r2Key: key,
      url: `${target.publicUrl}/${key}`,
      isPrimary: image.isPrimary,
      sortOrder: copied.length,
    });
  }
  // A gallery must have exactly one primary; the source's may have been the skipped photo.
  const [first] = copied;
  if (first && !copied.some((image) => image.isPrimary)) {
    first.isPrimary = true;
  }
  return copied;
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
    let uploadedKeys: string[] = [];
    try {
      // eslint-disable-next-line no-await-in-loop -- one product at a time: clear logs, clean rollback
      const images = await copyImages(product, source, target, report);
      uploadedKeys = images.map((image) => image.r2Key);

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

      // ONE statement = one implicit transaction: the row, its details and its gallery together.
      // eslint-disable-next-line no-await-in-loop -- see above
      const created = await target.prisma.product.create({ data, select: { id: true } });
      report.copied += 1;
      report.imagesCopied += images.length;
      console.log(`  ✓ ${product.name} → id ${created.id} (${images.length} photo(s))`);
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
