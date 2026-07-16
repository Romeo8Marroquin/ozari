import { Prisma } from "@prisma/client";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { ServiceStatusEnum } from "@models/enums/serviceStatusEnum.js";
import { appConfig } from "@/config/app.js";
import { isValidEnumValue } from "@helpers/utils.js";
import { getStorage, type Storage } from "@helpers/storage.js";
import {
  type CreateProductImageRequestModel,
  type PaginationMeta,
  type ProductListItemResponseModel,
  type ProductListQueryModel,
  type ProductListSortModel,
  type UpdateProductRequestModel,
} from "./products.models.js";

/**
 * The Prisma `include` for the FULL product shape — everything the richest role (Admin) can see.
 * We always fetch this and then narrow per role in `projectProductForRole` (see below), so the
 * role→fields mapping lives in exactly ONE place and the query never changes. Images and details are
 * scoped to their active rows; images come in the admin's DISPLAY order (`sortOrder`) — the primary
 * is a FLAG on whichever slot carries it, deliberately NOT forced to the front (the card shows the
 * flagged photo; the detail page opens on it, wherever it sits in the gallery).
 */
export const richProductInclude = {
  businessType: { select: { name: true } },
  category: { select: { name: true } },
  currency: { select: { id: true, iso4217Code: true, name: true, symbol: true } },
  rentTimeUnit: { select: { name: true } },
  // Details/images are hard-deleted rows (the no-trash policy) — every row that exists is live.
  productDetails: {
    select: {
      id: true,
      detail: true,
      productDetailTypeId: true,
      detailType: { select: { name: true } },
    },
  },
  productImages: {
    orderBy: [{ sortOrder: "asc" }],
    select: { id: true, url: true, isPrimary: true, sortOrder: true },
  },
} satisfies Prisma.ProductInclude;

/** A product row fetched with `richProductInclude` — the input to the role projection. */
export type RichProduct = Prisma.ProductGetPayload<{ include: typeof richProductInclude }>;

/** A Prisma `Decimal | null` money column → a plain `number` (or `undefined` when absent). */
const toMoney = (value: Prisma.Decimal | null): number | undefined =>
  value !== null ? Number(value) : undefined;

/**
 * Which rows the product list returns: the **active catalog**, narrowed by the parsed filters. Row
 * visibility stays uniform across roles (the role axis is the *fields*, see `projectProductForRole`)
 * with ONE exception already resolved upstream: `includeInactive` is only ever true for an Admin
 * (`parseProductListQuery` gates it), and it widens visibility to soft-deleted rows. Filter ids are
 * matched directly — a nonexistent id simply matches nothing (no 400, consistent with the clamp
 * stance).
 */
export function buildProductListWhere(
  query: ProductListQueryModel,
): Prisma.ProductWhereInput {
  return {
    ...(query.includeInactive ? {} : { isActive: true }),
    businessType: { isActive: true },
    category: { isActive: true },
    currency: { isActive: true },
    ...(query.search !== undefined
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {}),
    ...(query.categoryId !== undefined
      ? { productCategoryId: query.categoryId }
      : {}),
    ...(query.businessTypeId !== undefined
      ? { productBusinessTypeId: query.businessTypeId }
      : {}),
  };
}

/** Every accepted `sort` value — the parse allowlist (anything else clamps to the default). */
export const PRODUCT_LIST_SORTS: readonly ProductListSortModel[] = [
  "recent",
  "nameAsc",
  "nameDesc",
  "priceAsc",
  "priceDesc",
];

/** The five scalar columns the in-memory sorts need — a deliberately tiny select. */
export const productSortSelect = {
  id: true,
  name: true,
  rentPrice: true,
  sellPrice: true,
  createdAt: true,
} satisfies Prisma.ProductSelect;

/** A row fetched with `productSortSelect` — the in-memory sort's input. */
export type ProductSortRow = Prisma.ProductGetPayload<{
  select: typeof productSortSelect;
}>;

/** THE product's price under the conditional rule (rent XOR sell), or `null` when it has neither. */
const effectivePrice = (row: ProductSortRow): number | null => {
  const value = row.rentPrice ?? row.sellPrice;
  return value !== null ? Number(value) : null;
};

/** The default order (newest first, id tiebreak) — also every other sort's tiebreaker. */
const byRecency = (a: ProductSortRow, b: ProductSortRow): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;

/**
 * Orders the FULL filtered id set in memory and slices one page — the path for every non-default
 * sort. In memory on purpose: "price" is `COALESCE(rentPrice, sellPrice)` (a product has exactly
 * ONE price under the conditional rule) and "name" wants the Spanish collation — neither is
 * expressible through Prisma's `orderBy`, and the catalog is small (hundreds of rows; the sort
 * fetch selects five scalar columns). Revisit with raw SQL / a generated price column only if the
 * catalog ever outgrows this. Priceless rows sink to the end in BOTH price directions
 * (nulls-last); every tie falls back to the default recency order, so pages never shuffle.
 */
export function sortProductIdPage(
  rows: ProductSortRow[],
  sort: ProductListSortModel,
  page: number,
  pageSize: number,
): number[] {
  const direction = sort === "nameDesc" || sort === "priceDesc" ? -1 : 1;
  const byName = (a: ProductSortRow, b: ProductSortRow): number =>
    direction * a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  const byPrice = (a: ProductSortRow, b: ProductSortRow): number => {
    const priceA = effectivePrice(a);
    const priceB = effectivePrice(b);
    if (priceA === null || priceB === null) {
      // Nulls last regardless of direction — a priceless product should never LEAD either list.
      return Number(priceA === null) - Number(priceB === null);
    }
    return direction * (priceA - priceB);
  };

  const compare = sort === "nameAsc" || sort === "nameDesc" ? byName : byPrice;
  const ordered = [...rows].sort((a, b) => compare(a, b) || byRecency(a, b));
  const start = (page - 1) * pageSize;
  return ordered.slice(start, start + pageSize).map((row) => row.id);
}

/**
 * The ids of the RENT products among `products` — the only ones whose availability is DERIVED
 * (fleet minus units out on active rentals). A Venta product's `quantity` IS its availability:
 * sales decrement the record and a sold unit never comes back.
 */
export function rentProductIds(
  products: ReadonlyArray<Pick<RichProduct, "id" | "productBusinessTypeId">>,
): number[] {
  return products
    .filter(
      (product) => product.productBusinessTypeId === BusinessTypeEnum.RENT,
    )
    .map((product) => product.id);
}

/**
 * The `service_details` filter selecting every order line that HOLDS rental units *right now* —
 * the business rule behind the derived availability, in one place:
 *
 * - **DELIVERED** services hold their units regardless of the event window — the items are
 *   physically out until COLLECTED, so an overdue pickup keeps counting against availability;
 * - **PENDING** services hold theirs only while `now` falls inside `[serviceStart, serviceEnd]` —
 *   a booking for next week doesn't reduce TODAY's number (order-time validation will run this
 *   same rule against the *event's* window instead of `now`);
 * - **CANCELLED** / **COLLECTED** never hold, and soft-deleted lines/services don't either.
 */
export function buildRentedNowWhere(
  productIds: number[],
  now: Date,
): Prisma.ServiceDetailWhereInput {
  return {
    productId: { in: productIds },
    isActive: true,
    service: {
      isActive: true,
      OR: [
        { serviceStatusId: ServiceStatusEnum.DELIVERED },
        {
          serviceStatusId: ServiceStatusEnum.PENDING,
          serviceStart: { lte: now },
          serviceEnd: { gte: now },
        },
      ],
    },
  };
}

/**
 * Units of `product` a client could take RIGHT NOW. Venta: the recorded `quantity` (already
 * decremented by each sale). Alquiler: the fleet minus the units out on rentals (`rentedNow`, from
 * `buildRentedNowWhere`), floored at 0 — an overbooked fleet must never surface a negative count.
 */
export function computeAvailableQuantity(
  product: Pick<RichProduct, "quantity" | "productBusinessTypeId">,
  rentedNow: number,
): number {
  if (product.productBusinessTypeId !== BusinessTypeEnum.RENT) {
    return product.quantity;
  }
  return Math.max(0, product.quantity - rentedNow);
}

/**
 * Projects a full product to the shape a given role is allowed to see — **the single source of truth
 * for role→field visibility** (minimum privilege). Two tiers: everyone gets the shared "catalog"
 * fields (name/description/category/type/images/details/price + rent unit); **Admin** additionally
 * gets the availability and the internal detail — the `inStock` signal, the `available` count, for
 * Alquiler the `total` fleet in circulation ("5 de 10 disponibles", owner decision 2026-07-15),
 * plus `replacementPrice` and `isActive`. Anything that isn't Admin (Client, or any unexpected
 * role) gets the MINIMUM — fail-closed. The former Employee tier (`inStock` + `available`) was
 * REMOVED by Epic-2A (2026-07-16): role 3 is a Driver, blocked from products entirely at the
 * route; the availability tier returns only if a future office-employee type needs it. Change the
 * policy here and nowhere else.
 *
 * `rentedNow` is the product's currently-rented unit count (callers load it via
 * `buildRentedNowWhere`; defaults to 0 — correct for a just-created product and for Venta rows,
 * where it is ignored).
 */
export function projectProductForRole(
  product: RichProduct,
  role: RolesEnum,
  rentedNow = 0,
): ProductListItemResponseModel {
  const base: ProductListItemResponseModel = {
    id: product.id,
    name: product.name,
    description: product.description ?? undefined,
    businessType: product.businessType.name,
    businessTypeId: product.productBusinessTypeId,
    category: product.category.name,
    categoryId: product.productCategoryId,
    currency: {
      id: product.currency.id,
      iso4217Code: product.currency.iso4217Code,
      name: product.currency.name,
      symbol: product.currency.symbol,
    },
    rentPrice: toMoney(product.rentPrice),
    sellPrice: toMoney(product.sellPrice),
    rentTimeUnit: product.rentTimeUnit?.name ?? undefined,
    rentTimeUnitId: product.rentTimeUnitId ?? undefined,
    images: product.productImages.map((image) => ({
      id: image.id,
      url: image.url,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),
    details: product.productDetails.map((detail) => ({
      id: detail.id,
      detail: detail.detail,
      detailType: detail.detailType.name,
      detailTypeId: detail.productDetailTypeId,
    })),
  };

  const available = computeAvailableQuantity(product, rentedNow);

  if (role === RolesEnum.Admin) {
    return {
      ...base,
      inStock: available > 0,
      available,
      // The fleet total only means something for rentals (units come BACK); for Venta it would
      // just duplicate `available`. Field presence is the frontend's contract — keep it clean.
      ...(product.productBusinessTypeId === BusinessTypeEnum.RENT && {
        total: product.quantity,
      }),
      replacementPrice: toMoney(product.replacementPrice),
      isActive: product.isActive,
    };
  }

  // Client (and any unexpected role, incl. Driver — route-blocked anyway) → the minimum,
  // no stock information at all.
  return base;
}

/**
 * Parses the list query into a safe {@link ProductListQueryModel}. Everything **clamps or drops,
 * never rejects**: a bad pagination value falls back to the default (`page` floors at 1, `pageSize`
 * is bounded to `[1, maxProductPageSize]`), and a bad/absent FILTER simply drops out — so an
 * unbounded grid fetch is impossible and there is no 400 to handle. `includeInactive` is
 * **role-gated here** (Admin only): every other role gets `false` no matter what it sends, so the
 * widened row visibility can never leak past the projection's least-privileged consumers.
 */
export function parseProductListQuery(
  query: unknown,
  role: RolesEnum,
): ProductListQueryModel {
  const source = (query ?? {}) as Record<string, unknown>;
  const page = clampInt(source["page"], 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(
    source["pageSize"],
    appConfig.defaultProductPageSize,
    1,
    appConfig.maxProductPageSize,
  );

  const rawSearch = source["search"];
  const trimmedSearch =
    typeof rawSearch === "string"
      ? rawSearch.trim().slice(0, appConfig.maxProductSearchLength)
      : "";
  const search = trimmedSearch === "" ? undefined : trimmedSearch;

  const categoryId = parsePositiveInt(source["categoryId"]);

  const rawBusinessTypeId = parsePositiveInt(source["businessTypeId"]);
  const businessTypeId =
    rawBusinessTypeId !== undefined &&
    isValidEnumValue(BusinessTypeEnum, rawBusinessTypeId)
      ? rawBusinessTypeId
      : undefined;

  // Any role may sort (an ordering leaks nothing role-gated); an unknown value clamps to the
  // default, like every other bad input here.
  const rawSort = source["sort"];
  const sort = PRODUCT_LIST_SORTS.find((value) => value === rawSort) ?? "recent";

  const includeInactive =
    role === RolesEnum.Admin && source["includeInactive"] === "true";

  return {
    page,
    pageSize,
    search,
    categoryId,
    businessTypeId,
    sort,
    includeInactive,
  };
}

/** Parse `value` to a positive integer, or `undefined` when it isn't one (the filter drops out). */
function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** Parse `value` to an integer and clamp it to `[min, max]`; non-integers fall back to `fallback`. */
function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * The Prisma nested-create payload for a create's gallery images, or `undefined` when there are
 * none. Resolves the storage client ONLY when images exist — an image-less create must never depend
 * on the R2 env being configured. The public `url` is derived **server-side** from the validated
 * key (a client-sent URL is never persisted); array order = `sortOrder`.
 */
export function buildProductImagesCreate(
  images: CreateProductImageRequestModel[] | undefined,
): Prisma.ProductImageCreateNestedManyWithoutProductInput | undefined {
  // `?? []` = the same never-assume stance the controller takes on the role.
  const list = images ?? [];
  if (list.length === 0) {
    return undefined;
  }
  const storage = getStorage();
  return {
    create: list.map((image, index) => ({
      r2Key: image.key,
      url: storage.getPublicUrl(image.key),
      isPrimary: image.isPrimary === true,
      sortOrder: index,
    })),
  };
}

/**
 * Thrown inside the update transaction when a kept `id` (image or detail) no longer exists on the
 * product — someone else changed it between the editor's load and their save. Rolls the whole
 * transaction back; the controller maps it to a clean 409 ("reload and retry"), never a 500.
 */
export class ProductStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductStateConflictError";
  }
}

/**
 * Applies a validated `PUT /products/:id` body inside ONE transaction — the RECONCILE design
 * (owner decision, 2026-07-13): the body carries the product's FINAL desired state and this diffs
 * it against the current rows.
 *
 * - Scalars: plain update (absent conditional fields are set to explicit `null`, so a business-type
 *   switch can never leave a stale price behind).
 * - Images: kept rows (`id`) get their new `sortOrder`/`isPrimary`; rows absent from the list are
 *   **hard-deleted** (their R2 keys are RETURNED — the caller deletes the objects only AFTER the
 *   commit, so a rollback can never orphan DB rows pointing at deleted files); new keys are created
 *   with the server-derived URL (same stance as `buildProductImagesCreate` — a client URL is never
 *   persisted). Deletes run before creates, so a key freed in this same save is reusable.
 * - Details: same reconcile — kept rows update, absent rows are hard-deleted, new rows are created.
 *   Hard delete on purpose: details are pure attributes with no dependents, and tombstones would
 *   only accumulate (the no-garbage stance).
 *
 * Kept ids are re-checked against the CURRENT rows *inside* the transaction — a mismatch (the
 * validator saw an older state) throws {@link ProductStateConflictError} and rolls everything back.
 */
export async function applyProductUpdate(
  tx: Prisma.TransactionClient,
  productId: number,
  body: UpdateProductRequestModel,
): Promise<{ removedImageKeys: string[] }> {
  await tx.product.update({
    where: { id: productId },
    data: {
      name: body.name,
      description: body.description ?? null,
      productBusinessTypeId: body.businessTypeId,
      productCategoryId: body.categoryId,
      currencyId: body.currencyId,
      quantity: body.quantity,
      rentPrice: body.rentPrice ?? null,
      sellPrice: body.sellPrice ?? null,
      replacementPrice: body.replacementPrice ?? null,
      rentTimeUnitId: body.rentTimeUnitId ?? null,
    },
  });
  const removedImageKeys = await reconcileGalleryRows(tx, productId, body.images);
  await reconcileDetailRows(tx, productId, body.productDetails);
  return { removedImageKeys };
}

/** The kept ids present in the final list, verified against the CURRENT rows (409 on a mismatch). */
function assertKeptIdsExist(
  keptIds: ReadonlySet<number>,
  currentIds: ReadonlyArray<number>,
  what: string,
  productId: number,
): void {
  for (const keptId of keptIds) {
    if (!currentIds.includes(keptId)) {
      throw new ProductStateConflictError(
        `Kept ${what} ${keptId} no longer exists on product ${productId}`,
      );
    }
  }
}

/** The gallery half of the reconcile (see {@link applyProductUpdate}); returns the removed R2 keys. */
async function reconcileGalleryRows(
  tx: Prisma.TransactionClient,
  productId: number,
  images: UpdateProductRequestModel["images"],
): Promise<string[]> {
  const currentImages = await tx.productImage.findMany({
    where: { productId },
    select: { id: true, r2Key: true },
  });
  const keptImageIds = new Set(
    images.flatMap((image) => (image.id !== undefined ? [image.id] : [])),
  );
  assertKeptIdsExist(
    keptImageIds,
    currentImages.map((image) => image.id),
    "image",
    productId,
  );
  const removedImages = currentImages.filter((image) => !keptImageIds.has(image.id));
  if (removedImages.length > 0) {
    await tx.productImage.deleteMany({
      where: { id: { in: removedImages.map((image) => image.id) } },
    });
  }
  // Storage is resolved ONLY when new keys exist — an image-less save must never depend on R2 env.
  const storage = images.some((image) => image.key !== undefined) ? getStorage() : null;
  // Sequential on purpose: parallel queries inside a Prisma interactive transaction are unsafe
  // (one connection), and a gallery caps at 8 rows — the "optimization" isn't worth the hazard.
  for (const [index, image] of images.entries()) {
    if (image.id !== undefined) {
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      await tx.productImage.update({
        where: { id: image.id },
        data: { sortOrder: index, isPrimary: image.isPrimary === true },
      });
      continue;
    }
    // An id-less slot always carries a key, and storage resolved above the moment any key exists —
    // the validator's XOR rule. The casts encode that invariant; a runtime re-check would just be
    // an untestable branch.
    const key = image.key as string;
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.productImage.create({
      data: {
        productId,
        r2Key: key,
        url: (storage as Storage).getPublicUrl(key),
        sortOrder: index,
        isPrimary: image.isPrimary === true,
      },
    });
  }
  return removedImages.map((image) => image.r2Key);
}

/** The details half of the reconcile (see {@link applyProductUpdate}). */
async function reconcileDetailRows(
  tx: Prisma.TransactionClient,
  productId: number,
  productDetails: UpdateProductRequestModel["productDetails"],
): Promise<void> {
  const currentDetails = await tx.productDetail.findMany({
    where: { productId },
    select: { id: true },
  });
  const keptDetailIds = new Set(
    productDetails.flatMap((detail) => (detail.id !== undefined ? [detail.id] : [])),
  );
  assertKeptIdsExist(
    keptDetailIds,
    currentDetails.map((detail) => detail.id),
    "detail",
    productId,
  );
  const removedDetailIds = currentDetails
    .filter((detail) => !keptDetailIds.has(detail.id))
    .map((detail) => detail.id);
  if (removedDetailIds.length > 0) {
    await tx.productDetail.deleteMany({ where: { id: { in: removedDetailIds } } });
  }
  // Same sequential stance as the gallery loop above (single tx connection, tiny row counts).
  for (const detail of productDetails) {
    if (detail.id !== undefined) {
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      await tx.productDetail.update({
        where: { id: detail.id },
        data: { productDetailTypeId: detail.detailTypeId, detail: detail.detail },
      });
    } else {
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      await tx.productDetail.create({
        data: {
          productId,
          productDetailTypeId: detail.detailTypeId,
          detail: detail.detail,
        },
      });
    }
  }
}

/**
 * Applies a product deletion inside ONE transaction — the NO-TRASH policy (owner decision,
 * 2026-07-15): nothing ever tombstones unless order history demands it.
 *
 * - The product row survives (SOFT delete, `isActive: false`) ONLY when `service_details` rows
 *   reference it — hard-deleting it would orphan/falsify past orders. A product no order ever
 *   touched is HARD-deleted outright.
 * - Its details and gallery rows are hard-deleted EITHER WAY (pure attributes, no dependents),
 *   and every image's R2 key is RETURNED — the caller deletes the objects only AFTER the commit
 *   (one batched call), so a rollback can never orphan DB rows pointing at deleted files.
 */
export async function applyProductDelete(
  tx: Prisma.TransactionClient,
  productId: number,
): Promise<{ removedImageKeys: string[]; hardDeleted: boolean }> {
  // Every image row — a deletion sweeps the product's whole R2 footprint.
  const images = await tx.productImage.findMany({
    where: { productId },
    select: { r2Key: true },
  });
  await tx.productImage.deleteMany({ where: { productId } });
  await tx.productDetail.deleteMany({ where: { productId } });

  const orderReferences = await tx.serviceDetail.count({ where: { productId } });
  if (orderReferences > 0) {
    await tx.product.update({ where: { id: productId }, data: { isActive: false } });
  } else {
    await tx.product.delete({ where: { id: productId } });
  }
  return {
    removedImageKeys: images.map((image) => image.r2Key),
    hardDeleted: orderReferences === 0,
  };
}

/** Builds the pagination envelope returned alongside the products. */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
