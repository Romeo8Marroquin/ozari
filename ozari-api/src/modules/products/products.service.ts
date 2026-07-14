import { Prisma } from "@prisma/client";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { appConfig } from "@/config/app.js";
import { isValidEnumValue } from "@helpers/utils.js";
import { getStorage } from "@helpers/storage.js";
import {
  type CreateProductImageRequestModel,
  type PaginationMeta,
  type ProductListItemResponseModel,
  type ProductListQueryModel,
} from "./products.models.js";

/**
 * The Prisma `include` for the FULL product shape — everything the richest role (Admin) can see.
 * We always fetch this and then narrow per role in `projectProductForRole` (see below), so the
 * role→fields mapping lives in exactly ONE place and the query never changes. Images and details are
 * scoped to their active rows; images come primary-first, then by `sortOrder`.
 */
export const richProductInclude = {
  businessType: { select: { name: true } },
  category: { select: { name: true } },
  currency: { select: { id: true, iso4217Code: true, name: true, symbol: true } },
  rentTimeUnit: { select: { name: true } },
  productDetails: {
    where: { isActive: true },
    select: { id: true, detail: true, detailType: { select: { name: true } } },
  },
  productImages: {
    where: { isActive: true },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
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
    ...(query.inStock !== undefined
      ? { quantity: query.inStock ? { gt: 0 } : 0 }
      : {}),
  };
}

/**
 * Projects a full product to the shape a given role is allowed to see — **the single source of truth
 * for role→field visibility** (minimum privilege). Escalates: everyone gets the shared "catalog"
 * fields (name/description/category/type/images/details/price + rent unit); **Employee** additionally
 * gets an `inStock` availability *signal* (not the count); **Admin** gets the full internal detail
 * (the exact `quantity`, `replacementPrice`, `isActive`). Anything that isn't Admin/Employee (Client,
 * or any unexpected role) gets the MINIMUM — fail-closed. Change the policy here and nowhere else.
 */
export function projectProductForRole(
  product: RichProduct,
  role: RolesEnum,
): ProductListItemResponseModel {
  const base: ProductListItemResponseModel = {
    id: product.id,
    name: product.name,
    description: product.description ?? undefined,
    businessType: product.businessType.name,
    category: product.category.name,
    currency: {
      id: product.currency.id,
      iso4217Code: product.currency.iso4217Code,
      name: product.currency.name,
      symbol: product.currency.symbol,
    },
    rentPrice: toMoney(product.rentPrice),
    sellPrice: toMoney(product.sellPrice),
    rentTimeUnit: product.rentTimeUnit?.name ?? undefined,
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
    })),
  };

  if (role === RolesEnum.Admin) {
    return {
      ...base,
      inStock: product.quantity > 0,
      quantity: product.quantity,
      replacementPrice: toMoney(product.replacementPrice),
      isActive: product.isActive,
    };
  }

  if (role === RolesEnum.Employee) {
    return { ...base, inStock: product.quantity > 0 };
  }

  // Client (and any unexpected role) → the minimum, no stock information at all.
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

  // Stock is invisible to Clients in the projection, so the FILTER must be too (otherwise a Client
  // could probe availability by filtering). Employee and Admin may filter both ways.
  const canFilterStock =
    role === RolesEnum.Admin || role === RolesEnum.Employee;
  const rawInStock = source["inStock"];
  const inStock =
    canFilterStock && (rawInStock === "true" || rawInStock === "false")
      ? rawInStock === "true"
      : undefined;

  const includeInactive =
    role === RolesEnum.Admin && source["includeInactive"] === "true";

  return {
    page,
    pageSize,
    search,
    categoryId,
    businessTypeId,
    inStock,
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
