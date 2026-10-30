import { Prisma } from "@prisma/client";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { appConfig } from "@/config/app.js";
import { isValidEnumValue } from "@helpers/utils.js";
import { getStorage, type Storage } from "@helpers/storage.js";
import {
  VARIANT_LABEL_SEPARATOR,
  buildHoldingLinesWhere,
  stockKey,
  variantLabelOf,
} from "../orders/orders.service.js";
import {
  type CreateProductRequestModel,
  type PaginationMeta,
  type ProductArrangementItemModel,
  type ProductListItemResponseModel,
  type ProductListQueryModel,
  type ProductListSortModel,
  type ProductOptionRequestModel,
  type ProductVariantConflictModel,
  type ProductVariantOutcomeModel,
  type ProductVariantRequestModel,
  type ProductVariantResponseModel,
  type ProductVariantUsageModel,
  type ProductVariationImageRequestModel,
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
  // The SHOWCASE set only — every option value's own photos arrive under `options` below.
  productImages: {
    where: { optionValueId: null },
    orderBy: [{ sortOrder: "asc" }],
    select: { id: true, url: true, isPrimary: true, sortOrder: true },
  },
  // Variations (2026-10-29): the axes and their values in the admin's order (id tiebreaks a stale
  // duplicate sortOrder), each value with its photo set; and the ACTIVE variants with the raw
  // override columns — the projection derives labels, effective values and stock from these.
  options: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      values: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          images: {
            orderBy: [{ sortOrder: "asc" }],
            select: { id: true, url: true, isPrimary: true, sortOrder: true },
          },
        },
      },
    },
  },
  variants: {
    where: { isActive: true },
    orderBy: [{ id: "asc" }],
    select: {
      id: true,
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

/** A product row fetched with `richProductInclude` — the input to the role projection. */
export type RichProduct = Prisma.ProductGetPayload<{ include: typeof richProductInclude }>;

/** The flagged primary of a photo set, else its first; `undefined` for an empty set. */
export const primaryImageUrl = (
  images: ReadonlyArray<{ url: string; isPrimary: boolean }>,
): string | undefined => (images.find((image) => image.isPrimary) ?? images[0])?.url;

/** The option rows the variation helpers read (a subset of `richProductInclude.options`). */
export interface VariationOptionRow {
  id: number;
  name: string;
  sortOrder: number;
  values: ReadonlyArray<{
    id: number;
    name: string;
    sortOrder: number;
    images: ReadonlyArray<{ url: string; isPrimary: boolean }>;
  }>;
}

/** The variant rows the variation helpers read. */
export interface VariationVariantRow {
  id: number;
  isDefault: boolean;
  values: ReadonlyArray<{ optionValueId: number }>;
}

/** A variant placed in its product's structure. */
export interface DescribedVariant<V extends VariationVariantRow> {
  variant: V;
  /** Its value ids in OPTION order. */
  valueIds: number[];
  /** "Rojo · Redondo" — `variantLabelOf`'s format. */
  label: string;
  /** Its first value (option order) with photos → that set's primary; `undefined` when none has. */
  valueImageUrl: string | undefined;
  isDefault: boolean;
}

/**
 * Places every variant in its product's structure — THE variation reading shared by the projection,
 * the arrangement tiles and the update's outcome: value ids and label in option order, the photo
 * precedence (the first OPTION whose value has photos wins — reorder the options to change it), the
 * CANONICAL order (option order, then each option's value order — id breaks ties) and the default
 * (the flagged variant, else the first canonical one — exactly one).
 */
export function describeVariants<V extends VariationVariantRow>(
  options: readonly VariationOptionRow[],
  variants: readonly V[],
): DescribedVariant<V>[] {
  const valueInfo = new Map<
    number,
    { optionRank: number; valueRank: number; name: string; imageUrl: string | undefined }
  >();
  [...options]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .forEach((option, optionRank) => {
      [...option.values]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .forEach((value, valueRank) => {
          valueInfo.set(value.id, {
            optionRank,
            valueRank,
            name: value.name,
            imageUrl: primaryImageUrl(value.images),
          });
        });
    });

  const placed = variants.map((variant) => {
    const infos = variant.values
      .flatMap((value) => {
        const info = valueInfo.get(value.optionValueId);
        return info ? [{ id: value.optionValueId, ...info }] : [];
      })
      .sort((a, b) => a.optionRank - b.optionRank);
    return {
      variant,
      valueIds: infos.map((info) => info.id),
      label: infos.map((info) => info.name).join(VARIANT_LABEL_SEPARATOR),
      valueImageUrl: infos.find((info) => info.imageUrl !== undefined)?.imageUrl,
      ranks: infos.map((info) => info.valueRank),
    };
  });
  placed.sort((a, b) => {
    for (const [index, rank] of a.ranks.entries()) {
      const delta = rank - (b.ranks[index] ?? 0);
      if (delta !== 0) {
        return delta;
      }
    }
    return a.variant.id - b.variant.id;
  });
  const defaultId = (placed.find((entry) => entry.variant.isDefault) ?? placed[0])?.variant.id;
  return placed.map(({ ranks: _ranks, ...entry }) => ({
    ...entry,
    isDefault: entry.variant.id === defaultId,
  }));
}

/**
 * The photo a card or tile shows for a product: its SHOWCASE primary, else the DEFAULT variant's
 * value photo, else none. (An order line never uses this — see orders' `lineImageUrl`.)
 */
export function coverImageUrl(
  showcase: ReadonlyArray<{ url: string; isPrimary: boolean }>,
  described: ReadonlyArray<{ isDefault: boolean; valueImageUrl: string | undefined }>,
): string | undefined {
  return (
    primaryImageUrl(showcase) ?? described.find((entry) => entry.isDefault)?.valueImageUrl
  );
}

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
  "catalog",
  "recent",
  "nameAsc",
  "nameDesc",
  "priceAsc",
  "priceDesc",
];

/**
 * The two orders that live in SQL (every other sort is the in-memory id-page path). `catalog` is
 * the admin's arrangement: `display_order` first — 0 = never placed, so a new product LEADS — and
 * newest first underneath, which is also exactly the old default for a catalog nobody arranged.
 * `id` tiebreaks same-timestamp rows so pagination pages never shuffle.
 */
export const SQL_PRODUCT_ORDERS = {
  catalog: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  recent: [{ createdAt: "desc" }, { id: "desc" }],
} satisfies Record<"catalog" | "recent", Prisma.ProductOrderByWithRelationInput[]>;

/** Whether `sort` is ordered by the database (vs the in-memory name/price path). */
export const isSqlProductSort = (
  sort: ProductListSortModel,
): sort is keyof typeof SQL_PRODUCT_ORDERS => sort in SQL_PRODUCT_ORDERS;

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

/** Newest first (id tiebreak) — every in-memory sort's tiebreaker, like the SQL orders' tail. */
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
 * the business rule behind the derived availability, in one place, and now **read from the
 * lifecycle machine instead of hardcoded ids** (EPIC-2 order lifecycle, 2026-07-27):
 *
 * - statuses flagged `inventoryHold = OUT` hold their units unconditionally — the items are
 *   physically gone (on the truck / at the event) or back but not yet washed, so an overdue pickup
 *   or a pending cleaning keeps counting against availability;
 * - statuses flagged `WINDOW` hold theirs only while `now` falls inside `[serviceStart, serviceEnd]`
 *   — a booking for next week doesn't reduce TODAY's number;
 * - `NONE` statuses (Listo returned them to the fleet, Cancelado never took them) never hold, and
 *   soft-deleted lines/services and non-rental lines don't either.
 *
 * `holding` comes from `holdingStatusIds(catalog)` — pass the cached catalog's ids, never literals.
 * Empty id lists simply match nothing, which is the correct reading of "no status holds units".
 */
export function buildRentedNowWhere(
  productIds: number[],
  now: Date,
  holding: { out: number[]; window: number[] },
): Prisma.ServiceDetailWhereInput {
  return {
    productId: { in: productIds },
    isActive: true,
    // Rent-vs-sale is SNAPSHOTTED per line: a sold unit already left the recorded quantity, so it
    // must never also count as held (matters once a product's business type is edited).
    isRental: true,
    service: {
      isActive: true,
      cancelledAt: null,
      OR: [
        { serviceStatusId: { in: holding.out } },
        {
          serviceStatusId: { in: holding.window },
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

/** What the projection needs beyond the product row (both loaded by the caller). */
export interface ProductProjectionExtras {
  /** Units out on rentals right now, per stock pool (`stockKey`). */
  rentedNow?: ReadonlyMap<string, number>;
  /** Per-variant order-line usage (Admin, `GET /products/:id` + the PUT response only). */
  usage?: ReadonlyMap<number, ProductVariantUsageModel>;
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
 * Variations (2026-10-29): `options` and the ACTIVE `variants` ship to every role with EFFECTIVE
 * values (the variant's override, else the product's); the Admin tier adds each variant's stock,
 * its effective replacement value and its raw `overrides` (the form's prefill), and — when the
 * caller passes `usage` (detail + PUT only) — how order lines use it. A product WITH variants
 * reports its Admin stock as the Σ over them (`products.quantity` is 0 and never read).
 *
 * `extras.rentedNow` holds the units out on rentals right now per stock pool (`stockKey` — callers
 * load it via `buildRentedNowWhere`); absent = none, correct for a just-created product and for
 * Venta rows, where it is ignored.
 */
export function projectProductForRole(
  product: RichProduct,
  role: RolesEnum,
  extras: ProductProjectionExtras = {},
): ProductListItemResponseModel {
  const rentedNow = extras.rentedNow ?? new Map<string, number>();
  const isAdmin = role === RolesEnum.Admin;
  const isRent = product.productBusinessTypeId === BusinessTypeEnum.RENT;
  const showcasePrimary = primaryImageUrl(product.productImages);
  const described = describeVariants(product.options, product.variants);

  let variantStock = { quantity: 0, available: 0 };
  const variants = described.map(({ variant, valueIds, label, valueImageUrl, isDefault }) => {
    const projected: ProductVariantResponseModel = {
      id: variant.id,
      valueIds,
      label,
      isDefault,
      rentPrice: toMoney(variant.rentPrice ?? product.rentPrice),
      sellPrice: toMoney(variant.sellPrice ?? product.sellPrice),
      securityDeposit: toMoney(variant.securityDeposit ?? product.securityDeposit),
      description: variant.description ?? product.description ?? undefined,
      imageUrl: valueImageUrl ?? showcasePrimary,
    };
    if (!isAdmin) {
      return projected;
    }
    const available = computeAvailableQuantity(
      { quantity: variant.quantity, productBusinessTypeId: product.productBusinessTypeId },
      rentedNow.get(stockKey(product.id, variant.id)) ?? 0,
    );
    variantStock = {
      quantity: variantStock.quantity + variant.quantity,
      available: variantStock.available + available,
    };
    return {
      ...projected,
      quantity: variant.quantity,
      available,
      inStock: available > 0,
      ...(isRent && { total: variant.quantity }),
      replacementPrice: toMoney(variant.replacementPrice ?? product.replacementPrice),
      overrides: {
        rentPrice: toMoney(variant.rentPrice),
        sellPrice: toMoney(variant.sellPrice),
        replacementPrice: toMoney(variant.replacementPrice),
        securityDeposit: toMoney(variant.securityDeposit),
        description: variant.description ?? undefined,
      },
      ...(extras.usage && {
        usage: extras.usage.get(variant.id) ?? { lines: 0, holding: 0 },
      }),
    };
  });

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
    securityDeposit: toMoney(product.securityDeposit),
    images: product.productImages.map((image) => ({
      id: image.id,
      url: image.url,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),
    coverImageUrl: coverImageUrl(product.productImages, described),
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      sortOrder: option.sortOrder,
      values: option.values.map((value) => ({
        id: value.id,
        name: value.name,
        sortOrder: value.sortOrder,
        images: value.images.map((image) => ({
          id: image.id,
          url: image.url,
          isPrimary: image.isPrimary,
          sortOrder: image.sortOrder,
        })),
      })),
    })),
    variants,
    details: product.productDetails.map((detail) => ({
      id: detail.id,
      detail: detail.detail,
      detailType: detail.detailType.name,
      detailTypeId: detail.productDetailTypeId,
    })),
  };

  if (isAdmin) {
    // A product with variants: its stock IS theirs (Σ); without, its own pool.
    const stock =
      described.length > 0
        ? variantStock
        : {
            quantity: product.quantity,
            available: computeAvailableQuantity(
              product,
              rentedNow.get(stockKey(product.id, null)) ?? 0,
            ),
          };
    return {
      ...base,
      inStock: stock.available > 0,
      available: stock.available,
      // The fleet total only means something for rentals (units come BACK); for Venta it would
      // just duplicate `available`. Field presence is the frontend's contract — keep it clean.
      ...(isRent && { total: stock.quantity }),
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
  const sort = PRODUCT_LIST_SORTS.find((value) => value === rawSort) ?? "catalog";

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

/** The statuses that hold inventory — `holdingStatusIds(catalog)`, never literals. */
export interface HoldingStatusIds {
  out: number[];
  window: number[];
}

/**
 * How order lines use each variant of `productId` — `lines` = every line that references it (any
 * state: a referenced variant can only RETIRE), `holding` = those on open or future orders
 * (`buildHoldingLinesWhere`: removing it is a 409). Variants no line references have no entry.
 */
export async function loadVariantUsage(
  client: Pick<Prisma.TransactionClient, "serviceDetail">,
  productId: number,
  holding: HoldingStatusIds,
): Promise<Map<number, ProductVariantUsageModel>> {
  const where = { productId, variantId: { not: null } } satisfies Prisma.ServiceDetailWhereInput;
  const all = await client.serviceDetail.groupBy({
    by: ["variantId"],
    where,
    _count: { _all: true },
  });
  const held = await client.serviceDetail.groupBy({
    by: ["variantId"],
    where: { ...buildHoldingLinesWhere(holding), ...where },
    _count: { _all: true },
  });
  const heldById = new Map(held.map((row) => [row.variantId, row._count._all]));
  return new Map(
    all.map((row) => [
      row.variantId as number,
      { lines: row._count._all, holding: heldById.get(row.variantId) ?? 0 },
    ]),
  );
}

/**
 * Thrown inside the update transaction when the body drops a variant that HOLDING order lines still
 * use (open or future orders) — 409 `variantInUse`, each blocked variant listed with its orders. A
 * variant only HISTORY references retires instead (NO-TRASH); this guard keeps an order from
 * pointing at stock that no longer exists.
 */
export class ProductVariantInUseError extends Error {
  constructor(readonly conflicts: ProductVariantConflictModel[]) {
    super(`Variants ${conflicts.map((conflict) => conflict.variantId).join(",")} have holding lines`);
    this.name = "ProductVariantInUseError";
  }
}

/**
 * Thrown inside the update transaction when the body switches the product between product-level and
 * per-variant stock while HOLDING lines use the pool that would vanish — 409 `stockModeInUse`
 * (`orderIds`: the orders to finish or edit first). Finished and cancelled orders never block.
 */
export class ProductStockModeInUseError extends Error {
  constructor(readonly orderIds: number[]) {
    super(`Orders ${orderIds.join(",")} hold the product's current stock pool`);
    this.name = "ProductStockModeInUseError";
  }
}

/** Distinct order ids of `lines`, ascending. */
const distinctOrderIds = (lines: ReadonlyArray<{ serviceId: number }>): number[] =>
  [...new Set(lines.map((line) => line.serviceId))].sort((a, b) => a - b);

/** A variant's combination key — its value ids, sorted numerically, joined by "." ("12.34"). */
export const combinationKeyOf = (valueIds: readonly number[]): string =>
  [...valueIds].sort((a, b) => a - b).join(".");

/**
 * Applies a validated `POST /products` body inside the caller's transaction: the product row with
 * its details, then the variation structure (options → values → every photo set → variants) through
 * the SAME writers the update reconciles with — one write path, so the two doors cannot drift.
 * Returns the new product's id.
 */
export async function applyProductCreate(
  tx: Prisma.TransactionClient,
  body: CreateProductRequestModel,
): Promise<number> {
  const { id } = await tx.product.create({
    data: {
      ...productScalarData(body),
      ...(body.productDetails.length > 0 && {
        productDetails: {
          create: body.productDetails.map((detail) => ({
            productDetailTypeId: detail.detailTypeId,
            detail: detail.detail,
          })),
        },
      }),
    },
    select: { id: true },
  });
  const valueIdByKey = await upsertOptionsAndValues(tx, id, body.options);
  await reconcileImageSets(tx, id, imageSetsOf(body.images, body.options, valueIdByKey));
  await writeVariants(tx, id, body.variants, valueIdByKey, new Map());
  return id;
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
 * The product's SCALAR columns from a validated create/update body — ONE mapping for both doors, so
 * a new column can never be written on create and forgotten on edit. Absent conditional fields are
 * explicit `null`s: a business-type switch must never leave a stale price behind.
 */
export function productScalarData(body: CreateProductRequestModel | UpdateProductRequestModel) {
  return {
    name: body.name,
    description: body.description ?? null,
    productBusinessTypeId: body.businessTypeId,
    productCategoryId: body.categoryId,
    currencyId: body.currencyId,
    quantity: body.quantity,
    rentPrice: body.rentPrice ?? null,
    sellPrice: body.sellPrice ?? null,
    replacementPrice: body.replacementPrice ?? null,
    securityDeposit: body.securityDeposit ?? null,
    rentTimeUnitId: body.rentTimeUnitId ?? null,
  };
}

/**
 * Applies a validated `PUT /products/:id` body inside ONE transaction — the RECONCILE design
 * (owner decision, 2026-07-13): the body carries the product's FINAL desired state and this diffs
 * it against the current rows.
 *
 * - Scalars: plain update (absent conditional fields are set to explicit `null`, so a business-type
 *   switch can never leave a stale price behind).
 *   The scalar update runs FIRST: it takes the product row lock, which serializes this save against
 *   order writes on the same product (they lock it too) — the 409 pre-checks below read a stable
 *   state.
 * - 409 pre-checks (variations, 2026-10-29): switching between product-level and per-variant stock
 *   while HOLDING lines use the vanishing pool → {@link ProductStockModeInUseError}; dropping a
 *   variant HOLDING lines use → {@link ProductVariantInUseError}.
 * - Options, then values: kept ids update their name/order, new ones are created (key → id map).
 * - Images, across EVERY set (the showcase + each value's): kept rows (`id`) get their new set,
 *   `sortOrder` and `isPrimary` — a photo may move between sets; rows absent from the body are
 *   **hard-deleted** (their R2 keys are RETURNED — the caller deletes the objects only AFTER the
 *   commit, so a rollback can never orphan DB rows pointing at deleted files); new keys are created
 *   with the server-derived URL (a client URL is never persisted). Deletes run before creates, so a
 *   key freed in this same save is reusable.
 * - Variants, with a TWO-PHASE key write (see `writeVariants`), after the ones that left the body
 *   are removed: referenced by any order line → TOMBSTONE (NO-TRASH: history points at it), else
 *   hard delete — reported back as `variantOutcome`.
 * - Removed values, then removed options, are hard-deleted (attributes; history reads the line's
 *   `variantLabel` snapshot).
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
  holding: HoldingStatusIds,
): Promise<{ removedImageKeys: string[]; variantOutcome: ProductVariantOutcomeModel }> {
  await tx.product.update({ where: { id: productId }, data: productScalarData(body) });

  const currentOptions = await tx.productOption.findMany({
    where: { productId },
    select: { id: true, values: { select: { id: true } } },
  });
  const currentVariants = await tx.productVariant.findMany({
    where: { productId, isActive: true },
    select: {
      id: true,
      combinationKey: true,
      values: {
        select: { optionValue: { select: { name: true, option: { select: { sortOrder: true } } } } },
      },
    },
  });
  verifyKeptVariationIds(productId, body, currentOptions, currentVariants);

  const keptVariantIds = new Set(body.variants.flatMap((variant) => variant.id ?? []));
  const leaving = currentVariants.filter((variant) => !keptVariantIds.has(variant.id));
  await assertStockPoolsFree(tx, productId, holding, {
    hadVariants: currentVariants.length > 0,
    willHaveVariants: body.variants.length > 0,
    leaving,
  });

  const valueIdByKey = await upsertOptionsAndValues(tx, productId, body.options);
  const removedImageKeys = await reconcileImageSets(
    tx,
    productId,
    imageSetsOf(body.images, body.options, valueIdByKey),
  );

  const currentKeyById = new Map(
    currentVariants.map((variant) => [variant.id, variant.combinationKey]),
  );
  await parkChangedVariantKeys(tx, body.variants, valueIdByKey, currentKeyById);
  const variantOutcome = await removeLeavingVariants(tx, leaving);
  await writeVariants(tx, productId, body.variants, valueIdByKey, currentKeyById);

  const keptOptionIds = new Set(body.options.flatMap((option) => option.id ?? []));
  const keptValueIds = new Set(
    body.options.flatMap((option) => option.values.flatMap((value) => value.id ?? [])),
  );
  const removedValueIds = currentOptions
    .flatMap((option) => option.values.map((value) => value.id))
    .filter((id) => !keptValueIds.has(id));
  if (removedValueIds.length > 0) {
    await tx.productOptionValue.deleteMany({ where: { id: { in: removedValueIds } } });
  }
  const removedOptionIds = currentOptions
    .map((option) => option.id)
    .filter((id) => !keptOptionIds.has(id));
  if (removedOptionIds.length > 0) {
    await tx.productOption.deleteMany({ where: { id: { in: removedOptionIds } } });
  }

  await reconcileDetailRows(tx, productId, body.productDetails);
  return { removedImageKeys, variantOutcome };
}

/**
 * Re-checks the body's kept option/value/variant ids against the rows read INSIDE the transaction —
 * the validator saw an older state when a concurrent save changed them (409, reload and retry).
 */
function verifyKeptVariationIds(
  productId: number,
  body: UpdateProductRequestModel,
  currentOptions: ReadonlyArray<{ id: number; values: ReadonlyArray<{ id: number }> }>,
  currentVariants: ReadonlyArray<{ id: number }>,
): void {
  assertKeptIdsExist(
    new Set(body.options.flatMap((option) => option.id ?? [])),
    currentOptions.map((option) => option.id),
    "option",
    productId,
  );
  for (const option of body.options) {
    // A kept value must still sit under the SAME option (a new option has no current values).
    const currentValues =
      currentOptions.find((candidate) => candidate.id === option.id)?.values ?? [];
    assertKeptIdsExist(
      new Set(option.values.flatMap((value) => value.id ?? [])),
      currentValues.map((value) => value.id),
      "option value",
      productId,
    );
  }
  assertKeptIdsExist(
    new Set(body.variants.flatMap((variant) => variant.id ?? [])),
    currentVariants.map((variant) => variant.id),
    "variant",
    productId,
  );
}

/**
 * The two 409 guards (see {@link applyProductUpdate}). The stock-MODE check runs first: when the save
 * switches modes, every current variant leaves too, and "finish these orders before changing how
 * this product counts stock" is the truer message.
 */
async function assertStockPoolsFree(
  tx: Prisma.TransactionClient,
  productId: number,
  holding: HoldingStatusIds,
  pools: {
    hadVariants: boolean;
    willHaveVariants: boolean;
    leaving: ReadonlyArray<{ id: number; values: Parameters<typeof variantLabelOf>[0] }>;
  },
): Promise<void> {
  const { hadVariants, willHaveVariants, leaving } = pools;
  const holdingWhere = buildHoldingLinesWhere(holding);
  if (hadVariants !== willHaveVariants) {
    const lines = await tx.serviceDetail.findMany({
      where: { ...holdingWhere, productId, variantId: hadVariants ? { not: null } : null },
      select: { serviceId: true },
    });
    if (lines.length > 0) {
      throw new ProductStockModeInUseError(distinctOrderIds(lines));
    }
  }
  if (leaving.length === 0) {
    return;
  }
  const lines = await tx.serviceDetail.findMany({
    where: { ...holdingWhere, variantId: { in: leaving.map((variant) => variant.id) } },
    select: { serviceId: true, variantId: true },
  });
  const conflicts = leaving.flatMap((variant) => {
    const orderIds = distinctOrderIds(lines.filter((line) => line.variantId === variant.id));
    return orderIds.length > 0
      ? [{ variantId: variant.id, label: variantLabelOf(variant.values), orderIds }]
      : [];
  });
  if (conflicts.length > 0) {
    throw new ProductVariantInUseError(conflicts);
  }
}

/**
 * Writes the options and their values in body order (array index = `sortOrder`): a kept id updates
 * its name/order, an id-less entry is created. Returns every value's id by its client `key` — the
 * handle the variants and the photo sets resolve against. A kept value keeps its option (moving one
 * is a validator 400, re-checked by `verifyKeptVariationIds`).
 */
async function upsertOptionsAndValues(
  tx: Prisma.TransactionClient,
  productId: number,
  options: readonly ProductOptionRequestModel[],
): Promise<Map<string, number>> {
  const valueIdByKey = new Map<string, number>();
  // Sequential on purpose: one connection per interactive transaction (same stance as the gallery).
  for (const [optionIndex, option] of options.entries()) {
    const data = { name: option.name, sortOrder: optionIndex };
    const optionId =
      option.id === undefined
        ? // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
          (await tx.productOption.create({ data: { productId, ...data }, select: { id: true } })).id
        : // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
          (await tx.productOption.update({ where: { id: option.id }, data, select: { id: true } }))
            .id;
    for (const [valueIndex, value] of option.values.entries()) {
      if (value.id !== undefined) {
        // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
        await tx.productOptionValue.update({
          where: { id: value.id },
          data: { name: value.name, sortOrder: valueIndex },
        });
        valueIdByKey.set(value.key, value.id);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      const created = await tx.productOptionValue.create({
        data: { optionId, name: value.name, sortOrder: valueIndex },
        select: { id: true },
      });
      valueIdByKey.set(value.key, created.id);
    }
  }
  return valueIdByKey;
}

/** One photo set as the reconcile writes it: the showcase (`optionValueId` null) or a value's. */
interface ImageSet {
  optionValueId: number | null;
  images: readonly ProductVariationImageRequestModel[];
}

/** Every photo set of a body — the showcase first, then each value's, resolved to value ids. */
function imageSetsOf(
  showcase: readonly ProductVariationImageRequestModel[],
  options: readonly ProductOptionRequestModel[],
  valueIdByKey: ReadonlyMap<string, number>,
): ImageSet[] {
  return [
    { optionValueId: null, images: showcase },
    ...options.flatMap((option) =>
      option.values.map((value) => ({
        // Every body value was written by `upsertOptionsAndValues`, which keyed it — never absent.
        optionValueId: valueIdByKey.get(value.key) as number,
        images: value.images,
      })),
    ),
  ];
}

/**
 * Retires the variants that left the body: one an order line references (any state) TOMBSTONES —
 * `isActive`/`isDefault` false and its key freed as `retired:<id>`, so re-adding the combination
 * later creates a fresh row; one no line references is hard-deleted (its join rows cascade).
 */
async function removeLeavingVariants(
  tx: Prisma.TransactionClient,
  leaving: ReadonlyArray<{ id: number; values: Parameters<typeof variantLabelOf>[0] }>,
): Promise<ProductVariantOutcomeModel> {
  if (leaving.length === 0) {
    return { retired: [], deleted: 0 };
  }
  const referenced = await tx.serviceDetail.findMany({
    where: { variantId: { in: leaving.map((variant) => variant.id) } },
    distinct: ["variantId"],
    select: { variantId: true },
  });
  const referencedIds = new Set(referenced.map((line) => line.variantId));
  const retired = leaving.filter((variant) => referencedIds.has(variant.id));
  for (const variant of retired) {
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { isActive: false, isDefault: false, combinationKey: `retired:${variant.id}` },
    });
  }
  const deletedIds = leaving
    .filter((variant) => !referencedIds.has(variant.id))
    .map((variant) => variant.id);
  if (deletedIds.length > 0) {
    await tx.productVariant.deleteMany({ where: { id: { in: deletedIds } } });
  }
  return {
    retired: retired.map((variant) => ({ id: variant.id, label: variantLabelOf(variant.values) })),
    deleted: deletedIds.length,
  };
}

/** A body variant's final value ids (option order) — every key resolved by the option writer. */
const variantValueIds = (
  variant: ProductVariantRequestModel,
  valueIdByKey: ReadonlyMap<string, number>,
): number[] => variant.valueKeys.map((key) => valueIdByKey.get(key) as number);

/**
 * Phase 1 of the two-phase key write: every KEPT variant whose combination changes first parks on
 * `tmp:<id>`, so a swap (A takes B's combination while B takes A's) never trips the
 * `(product_id, combination_key)` unique index mid-save.
 */
async function parkChangedVariantKeys(
  tx: Prisma.TransactionClient,
  variants: readonly ProductVariantRequestModel[],
  valueIdByKey: ReadonlyMap<string, number>,
  currentKeyById: ReadonlyMap<number, string>,
): Promise<void> {
  for (const variant of variants) {
    if (
      variant.id === undefined ||
      currentKeyById.get(variant.id) === combinationKeyOf(variantValueIds(variant, valueIdByKey))
    ) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { combinationKey: `tmp:${variant.id}` },
    });
  }
}

/**
 * Phase 2: every body variant's final state — combination key, override columns (absent = inherit,
 * stored NULL), own stock and default flag. A kept variant whose combination changed also gets its
 * join rows replaced; a new one is created with them. Its id, stock and holds carry over.
 */
async function writeVariants(
  tx: Prisma.TransactionClient,
  productId: number,
  variants: readonly ProductVariantRequestModel[],
  valueIdByKey: ReadonlyMap<string, number>,
  currentKeyById: ReadonlyMap<number, string>,
): Promise<void> {
  for (const variant of variants) {
    const valueIds = variantValueIds(variant, valueIdByKey);
    const combinationKey = combinationKeyOf(valueIds);
    const data = {
      combinationKey,
      rentPrice: variant.rentPrice ?? null,
      sellPrice: variant.sellPrice ?? null,
      replacementPrice: variant.replacementPrice ?? null,
      securityDeposit: variant.securityDeposit ?? null,
      description: variant.description ?? null,
      quantity: variant.quantity,
      isDefault: variant.isDefault,
    };
    const joinRows = { create: valueIds.map((optionValueId) => ({ optionValueId })) };
    if (variant.id === undefined) {
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      await tx.productVariant.create({ data: { productId, ...data, values: joinRows } });
      continue;
    }
    const combinationChanged = currentKeyById.get(variant.id) !== combinationKey;
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.productVariant.update({
      where: { id: variant.id },
      data: {
        ...data,
        ...(combinationChanged && { values: { deleteMany: {}, ...joinRows } }),
      },
    });
  }
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

/**
 * The photo half of the reconcile (see {@link applyProductUpdate}) — EVERY set of the product at
 * once (the showcase and each value's), because a kept photo may move between sets; returns the
 * removed R2 keys. On create the product has no rows yet, so every slot is simply created.
 */
async function reconcileImageSets(
  tx: Prisma.TransactionClient,
  productId: number,
  sets: readonly ImageSet[],
): Promise<string[]> {
  const currentImages = await tx.productImage.findMany({
    where: { productId },
    select: { id: true, r2Key: true },
  });
  const keptImageIds = new Set(
    sets.flatMap((set) => set.images.flatMap((image) => image.id ?? [])),
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
  const storage = sets.some((set) => set.images.some((image) => image.key !== undefined))
    ? getStorage()
    : null;
  // Sequential on purpose: parallel queries inside a Prisma interactive transaction are unsafe
  // (one connection), and a product caps at 40 photos — the "optimization" isn't worth the hazard.
  // Each set numbers its own `sortOrder` from 0 and carries its own single primary.
  for (const { optionValueId, images } of sets) {
    for (const [index, image] of images.entries()) {
      const slot = { sortOrder: index, isPrimary: image.isPrimary === true, optionValueId };
      if (image.id !== undefined) {
        // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
        await tx.productImage.update({ where: { id: image.id }, data: slot });
        continue;
      }
      // An id-less slot always carries a key, and storage resolved above the moment any key exists
      // — the validator's XOR rule. The casts encode that invariant; a runtime re-check would just
      // be an untestable branch.
      const key = image.key as string;
      // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
      await tx.productImage.create({
        data: { productId, r2Key: key, url: (storage as Storage).getPublicUrl(key), ...slot },
      });
    }
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
 * - Its details and photo rows (EVERY set — showcase and each value's) are hard-deleted EITHER WAY
 *   (pure attributes, no dependents), and every image's R2 key is RETURNED — the caller deletes the
 *   objects only AFTER the commit (one batched call), so a rollback can never orphan DB rows
 *   pointing at deleted files.
 * - Variations (2026-10-29): a variant an order line references TOMBSTONES (like the product); the
 *   rest are hard-deleted. Options and values go either way (attributes — a line reads its
 *   `variantLabel` snapshot), which cascades every remaining join row.
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

  const referencedVariants = await tx.serviceDetail.findMany({
    where: { productId, variantId: { not: null } },
    distinct: ["variantId"],
    select: { variantId: true },
  });
  const referencedIds = referencedVariants.map((line) => line.variantId as number);
  // Already-retired variants keep their `retired:<id>` key; only live ones change here.
  const toRetire = await tx.productVariant.findMany({
    where: { productId, isActive: true, id: { in: referencedIds } },
    select: { id: true },
  });
  for (const variant of toRetire) {
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { isActive: false, isDefault: false, combinationKey: `retired:${variant.id}` },
    });
  }
  await tx.productVariant.deleteMany({ where: { productId, id: { notIn: referencedIds } } });
  await tx.productOptionValue.deleteMany({ where: { option: { productId } } });
  await tx.productOption.deleteMany({ where: { productId } });

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

/** What the arrangement screen reads per product — a card's worth, nothing more. */
export const arrangementSelect = {
  id: true,
  name: true,
  displayOrder: true,
  category: { select: { name: true } },
  businessType: { select: { name: true } },
  // The tile shows the product's cover (`coverImageUrl`): the showcase, else the default variant's
  // value photo — so the variation structure rides along, as lean as `describeVariants` allows.
  productImages: {
    where: { optionValueId: null },
    orderBy: [{ sortOrder: "asc" }],
    select: { url: true, isPrimary: true },
  },
  options: {
    select: {
      id: true,
      name: true,
      sortOrder: true,
      values: {
        select: {
          id: true,
          name: true,
          sortOrder: true,
          images: { orderBy: [{ sortOrder: "asc" }], select: { url: true, isPrimary: true } },
        },
      },
    },
  },
  variants: {
    where: { isActive: true },
    select: { id: true, isDefault: true, values: { select: { optionValueId: true } } },
  },
} satisfies Prisma.ProductSelect;

export type ArrangementRow = Prisma.ProductGetPayload<{ select: typeof arrangementSelect }>;

/** The arrangement screen's rows: the ACTIVE catalog, in catalog order (the grid's default). */
export const arrangementQuery = {
  where: { isActive: true },
  orderBy: SQL_PRODUCT_ORDERS.catalog,
  select: arrangementSelect,
} satisfies Prisma.ProductFindManyArgs;

/** One arrangement tile — the photo the grid card shows (`coverImageUrl`). */
export function projectArrangementItem(row: ArrangementRow): ProductArrangementItemModel {
  const imageUrl = coverImageUrl(row.productImages, describeVariants(row.options, row.variants));
  return {
    id: row.id,
    name: row.name,
    category: row.category.name,
    businessType: row.businessType.name,
    ...(imageUrl !== undefined && { imageUrl }),
    placed: row.displayOrder > 0,
  };
}

/**
 * Thrown inside the arrangement transaction when the submitted ids are not EXACTLY the active
 * catalog (a product was created or deleted while the screen was open). Rolls back; the controller
 * answers 409 — re-ordering a list the admin can no longer see would place products blindly.
 */
export class ProductDisplayOrderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductDisplayOrderConflictError";
  }
}

/**
 * Renumbers the active catalog to `productIds`' order (1..N) inside ONE transaction — and writes
 * only the rows whose position actually changed, so a typical drag of one card is one or two
 * UPDATEs, not N. The set check runs against the rows read INSIDE the transaction. Inactive
 * (soft-deleted) products keep whatever number they had; they are not in the grid.
 */
export async function applyProductDisplayOrder(
  tx: Prisma.TransactionClient,
  productIds: readonly number[],
): Promise<void> {
  const current = await tx.product.findMany({
    where: { isActive: true },
    select: { id: true, displayOrder: true },
  });
  const submitted = new Set(productIds);
  const matches =
    current.length === productIds.length &&
    current.every((row) => submitted.has(row.id));
  if (!matches) {
    throw new ProductDisplayOrderConflictError(
      `Submitted ${productIds.length} ids for an active catalog of ${current.length}`,
    );
  }
  const currentOrder = new Map(current.map((row) => [row.id, row.displayOrder]));
  // Sequential on purpose: one connection per interactive transaction (same stance as the gallery).
  for (const [index, id] of productIds.entries()) {
    const position = index + 1;
    if (currentOrder.get(id) === position) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- transactional writes must stay sequential
    await tx.product.update({ where: { id }, data: { displayOrder: position } });
  }
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
