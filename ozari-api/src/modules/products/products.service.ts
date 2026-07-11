import { Prisma } from "@prisma/client";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { appConfig } from "@/config/app.js";
import {
  type PaginationMeta,
  type ProductListItemResponseModel,
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
 * Which rows the product list returns. Currently the **active catalog** for every role (row
 * visibility is uniform; the role axis is the *fields*, see `projectProductForRole`). Kept as a
 * builder so search / category / business-type / admin-sees-inactive filters slot in here later
 * without touching the controller.
 */
export function buildProductListWhere(): Prisma.ProductWhereInput {
  return {
    isActive: true,
    businessType: { isActive: true },
    category: { isActive: true },
    currency: { isActive: true },
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
 * Parses the list query into a safe `{ page, pageSize }`. Everything **clamps** (never rejects): a
 * bad/absent value falls back to the default, `page` floors at 1, and `pageSize` is bounded to
 * `[1, maxProductPageSize]` — so an unbounded grid fetch is impossible and there is no 400 to handle.
 */
export function parseProductListQuery(query: unknown): {
  page: number;
  pageSize: number;
} {
  const source = (query ?? {}) as Record<string, unknown>;
  const page = clampInt(source["page"], 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(
    source["pageSize"],
    appConfig.defaultProductPageSize,
    1,
    appConfig.maxProductPageSize,
  );
  return { page, pageSize };
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
