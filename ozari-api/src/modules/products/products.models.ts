import type { CurrencyModel } from "@/models/common/currencyModel.js";

export interface CreateProductDetailRequestModel {
  detail: string;
  detailTypeId: number;
}

/**
 * A gallery image attached at create time. The client sends only the R2 object `key` it got from
 * `POST /products/images/upload-url` (after PUTting the file straight to R2) — the public URL is
 * derived **server-side** from the key, never trusted from the client. Array order = `sortOrder`.
 */
export interface CreateProductImageRequestModel {
  /** R2 object key minted by the upload-url endpoint (`products/<uuid>.<ext>`). */
  key: string;
  /** At most ONE may be true; when none is flagged the FIRST image becomes the primary. */
  isPrimary?: boolean;
}

/** One file the client wants a presigned PUT for (`POST /products/images/upload-url`). */
export interface ProductImageUploadFileModel {
  contentType: string;
  contentLength: number;
}

export interface CreateProductImageUploadsRequestModel {
  files: ProductImageUploadFileModel[];
}

/** A minted presigned upload: PUT the file to `uploadUrl`, then reference `key` on create. */
export interface ProductImageUploadResponseModel {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface ProductImageUploadsResponseModel {
  uploads: ProductImageUploadResponseModel[];
}

export interface CreateProductRequestModel {
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  description: string | undefined;
  /** Sanitized by the validator: every `isPrimary` resolved (exactly one true when non-empty). */
  images: CreateProductImageRequestModel[];
  name: string;
  productDetails: CreateProductDetailRequestModel[];
  quantity: number;
  /** Required when `businessTypeId` = Alquiler; forbidden for Venta (see the conditional price rule). */
  rentPrice: number | undefined;
  /** The period the rent price is quoted against — required with `rentPrice`, forbidden for Venta. */
  rentTimeUnitId: number | undefined;
  /** "As-new" value billed for a lost/damaged RENTAL — Alquiler only (a sale is consumed, nothing
   *  to replace); optional there, forbidden for Venta. */
  replacementPrice: number | undefined;
  /** Required when `businessTypeId` = Venta; forbidden for Alquiler. */
  sellPrice: number | undefined;
}

/**
 * One detail row in the FINAL desired detail list (`PUT /products/:id` is declarative, like the
 * gallery): `id` present = an existing row of THIS product to keep/update; absent = create. Rows
 * the product has that are missing from the list are deleted — the list IS the state.
 */
export interface UpdateProductDetailRequestModel extends CreateProductDetailRequestModel {
  id?: number;
}

/**
 * One slot of the FINAL desired gallery (the RECONCILE design — owner decision, 2026-07-13):
 * exactly ONE of `id` (a kept photo of this product) or `key` (a new photo already uploaded via the
 * presign flow). Array order = `sortOrder`; at most one `isPrimary` (default: the first). Rows the
 * product has that are absent from the list are deleted (DB row + the R2 object, post-commit).
 */
export interface UpdateProductImageRequestModel {
  id?: number;
  key?: string;
  isPrimary?: boolean;
}

/**
 * `PUT /products/:id` — the product's FULL desired state (never a partial patch): the same scalar
 * rules as create (incl. the conditional price rule), plus the declarative details + gallery lists.
 * The id travels in the route param, not the body.
 */
export interface UpdateProductRequestModel
  extends Omit<CreateProductRequestModel, "images" | "productDetails"> {
  images: UpdateProductImageRequestModel[];
  productDetails: UpdateProductDetailRequestModel[];
}

export interface BaseProductDetailsResponseModel {
  detail: string;
  detailType: string;
  /** The type's lookup id — what the edit form prefills its select with (public reference data). */
  detailTypeId: number;
  id: number;
}

export interface ProductImageResponseModel {
  id: number;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

/**
 * A product as returned by the list endpoint. The "catalog" fields are visible to every role; the
 * `inStock`/`available`/`total`/`replacementPrice`/`isActive` fields are **role-gated** — present
 * only for the roles allowed to see them (see `projectProductForRole`), so they are optional here.
 */
export interface ProductListItemResponseModel {
  id: number;
  name: string;
  description: string | undefined;
  businessType: string;
  /** The business type's lookup id (1 = Alquiler, 2 = Venta) — the edit form's select value.
   *  Public reference data (the name is already in `businessType`), so it ships to every role. */
  businessTypeId: number;
  category: string;
  /** The category's lookup id — same public-reference stance as `businessTypeId`. */
  categoryId: number;
  currency: CurrencyModel;
  rentPrice: number | undefined;
  sellPrice: number | undefined;
  /** The period `rentPrice` is quoted against (Alquiler only), e.g. "Día". */
  rentTimeUnit: string | undefined;
  /** Its lookup id (Alquiler only) — the edit form's select value; absent alongside `rentTimeUnit`. */
  rentTimeUnitId: number | undefined;
  images: ProductImageResponseModel[];
  details: BaseProductDetailsResponseModel[];
  /** Availability signal (Employee + Admin) — derived: `available > 0`. */
  inStock?: boolean;
  /**
   * Units takeable RIGHT NOW (Employee + Admin). Venta: the recorded stock (sales decrement it).
   * Alquiler: fleet minus units out on active rentals (see `buildRentedNowWhere`).
   */
  available?: number;
  /**
   * The WHOLE rental fleet in circulation (Admin only, **Alquiler only** — absent for Venta, where
   * it would duplicate `available`): `available` + currently rented.
   */
  total?: number;
  /** "As-new" replacement value (Admin only; may itself be absent on a product). */
  replacementPrice?: number | undefined;
  /** Soft-delete flag (Admin only). */
  isActive?: boolean;
}

/**
 * The catalog's presentation orders. `recent` (newest first) is the default; `name*` uses the
 * Spanish collation; `price*` orders by THE product's price — rent or sell, whichever it has (the
 * conditional rule guarantees exactly one) — with priceless rows sinking to the end either way.
 * There is deliberately NO availability filter/sort: "available" means different things per role
 * (an admin cares about the whole fleet) and a rented-out product isn't gone — sorting replaced it
 * (owner decision, 2026-07-15). A "popular" order awaits real order data (see EPIC-1 §5).
 */
export type ProductListSortModel =
  | "recent"
  | "nameAsc"
  | "nameDesc"
  | "priceAsc"
  | "priceDesc";

/**
 * The parsed `GET /products` query — pagination plus the optional catalog filters and the sort.
 * Everything is produced by `parseProductListQuery` under the clamp-never-reject stance: a bad
 * value falls back (pagination/sort) or drops out (filters), so this shape is always safe to hand
 * to Prisma.
 */
export interface ProductListQueryModel {
  page: number;
  pageSize: number;
  /** Case-insensitive name substring; absent when not searching. */
  search: string | undefined;
  categoryId: number | undefined;
  businessTypeId: number | undefined;
  /** Presentation order — any role may sort (nothing role-gated leaks through an ordering). */
  sort: ProductListSortModel;
  /** Admin-only: include soft-deleted rows. Always false for every other role. */
  includeInactive: boolean;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProductListResponseModel {
  products: ProductListItemResponseModel[];
  pagination: PaginationMeta;
}

/** `GET /products/:id` — the same role-projected shape as a list item, single row. */
export interface ProductDetailResponseModel {
  product: ProductListItemResponseModel;
}

/** A seeded lookup row as the create/edit form consumes it — just enough to render a select. */
export interface CatalogOptionModel {
  id: number;
  name: string;
}

export interface CurrencyCatalogOptionModel extends CatalogOptionModel {
  iso4217Code: string;
  symbol: string;
}

/**
 * The reference data the product create/edit form needs (`GET /products/catalog`): every ACTIVE row
 * of the five seeded lookups, id + display name only. Available to any authenticated role — it's
 * public reference data (names already appear on every projected product), and employee-facing
 * filters will want it later.
 */
export interface ProductCatalogResponseModel {
  businessTypes: CatalogOptionModel[];
  categories: CatalogOptionModel[];
  currencies: CurrencyCatalogOptionModel[];
  detailTypes: CatalogOptionModel[];
  rentTimeUnits: CatalogOptionModel[];
}
