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

/**
 * One photo slot of a VARIATION set (an option value's photos) — the update gallery's shape: exactly
 * one of `id` (a kept photo of this product, from ANY set — a photo may move between sets) or `key`
 * (a new upload). On create every slot carries a `key` (ids are forbidden). Sanitized: `isPrimary`
 * resolved (exactly one true per non-empty set).
 */
export interface ProductVariationImageRequestModel {
  id?: number;
  key?: string;
  isPrimary?: boolean;
}

/** One value of an option ("Rojo"). `key` is the client-minted handle variants reference it by. */
export interface ProductOptionValueRequestModel {
  /** Update only: a kept value of THIS option (moving a value between options is a 400). */
  id?: number;
  key: string;
  name: string;
  images: ProductVariationImageRequestModel[];
}

/** One option ("Color"); array order = `sortOrder` (label order AND photo precedence). */
export interface ProductOptionRequestModel {
  /** Update only: a kept option of THIS product. */
  id?: number;
  name: string;
  values: ProductOptionValueRequestModel[];
}

/**
 * One OFFERED combination. `valueKeys` holds exactly one value key per option — sanitized into
 * option order. Overrides follow the product's business type (Alquiler: rent/replacement/deposit;
 * Venta: sell); absent = inherit the product's value. A deposit of 0 = explicitly none.
 */
export interface ProductVariantRequestModel {
  /** Update only: an ACTIVE variant of this product (its stock and holds carry over). */
  id?: number;
  valueKeys: string[];
  quantity: number;
  rentPrice: number | undefined;
  sellPrice: number | undefined;
  replacementPrice: number | undefined;
  securityDeposit: number | undefined;
  description: string | undefined;
  isDefault: boolean;
}

export interface CreateProductRequestModel {
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  description: string | undefined;
  /** Sanitized by the validator: every `isPrimary` resolved (exactly one true when non-empty).
   *  The product's SHOWCASE photos only — value photos travel inside `options`. */
  images: CreateProductImageRequestModel[];
  name: string;
  productDetails: CreateProductDetailRequestModel[];
  /** The product's stock when it has NO variations; resolved to 0 by the validator when it has
   *  (the request must then omit it — `quantityWithVariants`), whose stock lives on each variant. */
  quantity: number;
  /** Variation axes, in order; empty = a product without variations. */
  options: ProductOptionRequestModel[];
  /** The offered combinations — empty exactly when `options` is. */
  variants: ProductVariantRequestModel[];
  /** Required when `businessTypeId` = Alquiler; forbidden for Venta (see the conditional price rule). */
  rentPrice: number | undefined;
  /** The period the rent price is quoted against — required with `rentPrice`, forbidden for Venta. */
  rentTimeUnitId: number | undefined;
  /** "As-new" value billed for a lost/damaged RENTAL — Alquiler only (a sale is consumed, nothing
   *  to replace); optional there, forbidden for Venta. */
  replacementPrice: number | undefined;
  /** Refundable security deposit PER UNIT ("garantía", owner 2026-10-27) — Alquiler only, optional,
   *  never above `replacementPrice` when both are set (it covers partial damage; a total loss is
   *  billed at the replacement price). Not part of any price: orders snapshot it per line. */
  securityDeposit: number | undefined;
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

/** One value of an option as projected (its photo set in display order). */
export interface ProductOptionValueResponseModel {
  id: number;
  name: string;
  sortOrder: number;
  images: ProductImageResponseModel[];
}

/** One variation axis as projected, values in their order. */
export interface ProductOptionResponseModel {
  id: number;
  name: string;
  sortOrder: number;
  values: ProductOptionValueResponseModel[];
}

/** The raw override columns of a variant (Admin only) — what the edit form prefills; absent = inherit. */
export interface ProductVariantOverridesModel {
  rentPrice?: number | undefined;
  sellPrice?: number | undefined;
  replacementPrice?: number | undefined;
  securityDeposit?: number | undefined;
  description?: string | undefined;
}

/** How order lines use a variant (Admin only, detail + PUT): every line, and the HOLDING ones. */
export interface ProductVariantUsageModel {
  lines: number;
  holding: number;
}

/**
 * One ACTIVE variant as projected, with EFFECTIVE values (its override, else the product's).
 * `label` is its values' names in option order ("Rojo · Redondo"). Exactly one variant of a product
 * has `isDefault: true` (the flagged one, else the first in canonical order).
 */
export interface ProductVariantResponseModel {
  id: number;
  valueIds: number[];
  label: string;
  isDefault: boolean;
  rentPrice?: number | undefined;
  sellPrice?: number | undefined;
  securityDeposit?: number | undefined;
  description?: string | undefined;
  /** Its first value (in option order) with photos gives its primary; else the showcase primary. */
  imageUrl?: string | undefined;
  /** Admin only — the variant's own stock and availability (same rules as a product's). */
  quantity?: number;
  available?: number;
  inStock?: boolean;
  /** Admin only, Alquiler only. */
  total?: number;
  /** Admin only — effective replacement value. */
  replacementPrice?: number | undefined;
  /** Admin only — the raw override columns. */
  overrides?: ProductVariantOverridesModel;
  /** Admin only, `GET /products/:id` + the PUT response only. */
  usage?: ProductVariantUsageModel;
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
  /** Refundable security deposit per unit (Alquiler only; absent when the product asks none). A
   *  public commercial condition like the price — every role sees it, unlike `replacementPrice`. */
  securityDeposit: number | undefined;
  /** The product's SHOWCASE photos only (value photos live under `options[].values[].images`). */
  images: ProductImageResponseModel[];
  /** The photo a card/tile shows: the showcase primary, else the DEFAULT variant's image, else absent. */
  coverImageUrl?: string | undefined;
  /** Variation axes in order — empty for a product without variations. */
  options: ProductOptionResponseModel[];
  /** ACTIVE variants in canonical order (option order, then value order) — empty without variations. */
  variants: ProductVariantResponseModel[];
  details: BaseProductDetailsResponseModel[];
  /** Availability signal (Admin only) — derived: `available > 0`. For a product WITH variants every
   *  stock figure (`inStock`/`available`/`total`) is the Σ over its active variants. */
  inStock?: boolean;
  /**
   * Units takeable RIGHT NOW (Admin only). Venta: the recorded stock (sales decrement it).
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
 * The catalog's presentation orders. `catalog` (the admin's arrangement — `display_order`, then
 * newest first) is the default; `recent` is newest first; `name*` uses the
 * Spanish collation; `price*` orders by THE product's price — rent or sell, whichever it has (the
 * conditional rule guarantees exactly one) — with priceless rows sinking to the end either way.
 * There is deliberately NO availability filter/sort: "available" means different things per role
 * (an admin cares about the whole fleet) and a rented-out product isn't gone — sorting replaced it
 * (owner decision, 2026-07-15). A "popular" order awaits real order data (see EPIC-1 §5).
 */
export type ProductListSortModel =
  | "catalog"
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

/** What a `PUT /products/:id` did to the variants that left the body (NO-TRASH, reported — the UI
 *  never guesses): `retired` were referenced by order history and tombstoned; `deleted` hard-deleted. */
export interface ProductVariantOutcomeModel {
  retired: { id: number; label: string }[];
  deleted: number;
}

/** `PUT /products/:id` — the projected product, plus `variantOutcome` when any variant was removed. */
export interface UpdateProductResponseModel extends ProductListItemResponseModel {
  variantOutcome?: ProductVariantOutcomeModel;
}

/** `DELETE /products/:id` — which NO-TRASH branch happened (order history keeps a deactivated row). */
export interface DeleteProductResponseModel {
  outcome: "deleted" | "deactivated";
}

/** One variant whose removal is blocked by HOLDING order lines (409 `variantInUse`). */
export interface ProductVariantConflictModel {
  variantId: number;
  label: string;
  orderIds: number[];
}

/**
 * One tile of the arrangement screen (`GET|PUT /products/display-order`, Admin only): just what a
 * small card needs. `imageUrl` is the primary photo (else the first, else absent); `placed` is false
 * while the product still has `display_order` 0 — never arranged, so it currently LEADS the grid.
 */
export interface ProductArrangementItemModel {
  id: number;
  name: string;
  category: string;
  businessType: string;
  imageUrl?: string;
  placed: boolean;
}

export interface ProductArrangementResponseModel {
  products: ProductArrangementItemModel[];
}

/**
 * `PUT /products/display-order` — the FULL ordered list of ACTIVE product ids (declarative, like
 * every other write here: the list IS the order). A list that is not exactly the active catalog is
 * a 409, never a partial apply — someone added or removed a product while the screen was open.
 */
export interface UpdateProductDisplayOrderRequestModel {
  productIds: number[];
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

/** A zone lookup carrying its DEFAULT delivery fee (owner 2026-07-23 — zones drive fee pricing).
 *  `deliveryFee` is `undefined` when the zone has no configured fee (distinct from 0 = free). */
export interface ZoneCatalogOptionModel extends CatalogOptionModel {
  deliveryFee?: number;
}

/**
 * The reference data the product create/edit form needs (`GET /products/catalog`): every ACTIVE row
 * of the five seeded lookups, id + display name only. Admin + Client (like every products read —
 * Epic-2A): it's public reference data (names already appear on every projected product), and the
 * client-facing filters consume it too.
 */
export interface ProductCatalogResponseModel {
  businessTypes: CatalogOptionModel[];
  categories: CatalogOptionModel[];
  currencies: CurrencyCatalogOptionModel[];
  detailTypes: CatalogOptionModel[];
  rentTimeUnits: CatalogOptionModel[];
}
