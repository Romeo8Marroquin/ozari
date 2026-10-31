/**
 * The product shapes returned by `GET /products`, **mirrored from the backend**
 * `ProductListItemResponseModel` (`ozari-api/src/modules/products/products.models.ts`). The list is
 * **role-projected**: the backend narrows the fields per role (minimum privilege), so the stock-related
 * fields below are **optional** — their mere presence IS the contract:
 *
 * - everyone allowed in (Admin + Client — a Driver can't read products at all, Epic-2A) gets the
 *   shared catalog fields (name, price, images, …);
 * - **Admin** additionally gets the availability (`inStock` + the `available` count), the internal
 *   detail (`replacementPrice`, `isActive`) and — for Alquiler only — the fleet `total` alongside
 *   the available slice ("5 de 10 disponibles").
 *
 * The UI reacts to which fields exist rather than re-deriving the role, so if the projection changes it
 * changes in exactly two mirrored places (this file + the backend model). Do not read a gated field
 * without guarding for `undefined`.
 */

export interface ProductImage {
  id: number;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ProductDetail {
  id: number;
  detail: string;
  detailType: string;
  /** The type's lookup id — what the edit form prefills its select with. */
  detailTypeId: number;
}

/** One value of a product OPTION ("Rojo" of "Color") — with its OWN photo set (its primary flagged,
 *  else the first). Array order = `sortOrder`. */
export interface ProductOptionValue {
  id: number;
  name: string;
  sortOrder: number;
  images: ProductImage[];
  /** `#rrggbb` — present exactly on the values of a `color` option (the swatch; the NAME is what
   *  every text prints, e.g. "Marfil"). */
  color?: string;
}

/** What an option IS (owner 2026-10-30): `generic` is any axis ("Tamaño", "Forma"); `color` is the
 *  one special axis whose values carry a real colour and pick as swatches. One per product at most. */
export type ProductOptionKind = 'generic' | 'color';

/** A product OPTION ("Color", "Tamaño"). Its order is the label order AND the photo precedence. */
export interface ProductOption {
  id: number;
  name: string;
  sortOrder: number;
  kind: ProductOptionKind;
  values: ProductOptionValue[];
}

/** A variation's RAW override columns (Admin only) — what the edit form prefills; absent = inherits
 *  the product's. A `securityDeposit` of 0 is an explicit "no deposit" for that variation. */
export interface ProductVariantOverrides {
  rentPrice?: number;
  sellPrice?: number;
  replacementPrice?: number;
  securityDeposit?: number;
  description?: string;
}

/** How many order lines reference a variation (detail + PUT only, Admin): `holding` of them still
 *  reserve stock (open/future orders) — removing it is then refused (409 `variantInUse`); history
 *  only (`lines` > 0) retires it; none deletes it. The form words its removal from THIS. */
export interface ProductVariantUsage {
  lines: number;
  holding: number;
}

/**
 * One OFFERED combination of option values (active variations only, canonical order). Prices and
 * deposit are EFFECTIVE (the variation's override, else the product's) — computed by the API, never
 * re-derived here. Exactly one carries `isDefault`.
 */
export interface ProductVariant {
  id: number;
  /** One value id per option, in option order. */
  valueIds: number[];
  /** Its option values only, e.g. "Rojo · Redondo" (a variation has no custom title). */
  label: string;
  isDefault: boolean;
  rentPrice?: number;
  sellPrice?: number;
  securityDeposit?: number;
  /** The variation's OWN text only — it STACKS under the product's description, never replaces it. */
  description?: string;
  /** Its photo: the first of its values (in option order) that has photos gives its primary, else
   *  the product's showcase primary; absent when neither exists. */
  imageUrl?: string;
  /** Admin only — its OWN stock (fleet for rent, shelf for sale); with `sharedStock`, the product's
   *  one pool (every variation then reports the same figures). */
  quantity?: number;
  /** Admin only — takeable right now (same meaning as the product's). */
  available?: number;
  inStock?: boolean;
  /** Admin only, Alquiler — the variation's whole fleet. */
  total?: number;
  /** Admin only — effective replacement value. */
  replacementPrice?: number;
  overrides?: ProductVariantOverrides;
  usage?: ProductVariantUsage;
}

export interface ProductCurrency {
  id: number;
  iso4217Code: string;
  name: string;
  symbol: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  businessType: string;
  /** The business type's lookup id (1 = Alquiler, 2 = Venta) — the edit form's select value. */
  businessTypeId: number;
  category: string;
  /** The category's lookup id — same public-reference stance as `businessTypeId`. */
  categoryId: number;
  currency: ProductCurrency;
  /** Rental price per `rentTimeUnit`; absent for sale-only products — and possibly for a product
   *  with variations, where it is only the DEFAULT the variations without their own inherit. */
  rentPrice?: number;
  /** Outright sale price; absent for rent-only products (same variations caveat). */
  sellPrice?: number;
  /** The rental period the `rentPrice` applies to (e.g. "Día"); present with `rentPrice`. */
  rentTimeUnit?: string;
  /** Its lookup id (Alquiler only) — present alongside `rentTimeUnit`. */
  rentTimeUnitId?: number;
  /** Refundable security deposit per unit ("Depósito", Alquiler only) — a public commercial
   *  condition like the price, so every role receives it. Never part of a price. */
  securityDeposit?: number;
  /** The product's SHOWCASE photos (the whole product, every variation) — never a value's photos. */
  images: ProductImage[];
  /** What a tile shows: the showcase primary, else the DEFAULT variation's photo, else the first
   *  variation (canonical order) with one, else any value's photo, else absent. */
  coverImageUrl?: string;
  /** The product's options (empty/absent = no variations). */
  options?: ProductOption[];
  /** Its ACTIVE variations, canonical order (empty/absent = no variations). For a product WITH
   *  variations the product-level Admin stock (`available`/`total`/`inStock`) is their SUM — or,
   *  with `sharedStock`, the one pool they all draw from. */
  variants?: ProductVariant[];
  /** The variations are CONFIGURATIONS of the same units (an arrangement with or without its
   *  add-on): one stock on the product that every variation takes from. `false` = each variation is
   *  its own item with its own stock (candles by colour). Meaningless without variations. */
  sharedStock?: boolean;
  details: ProductDetail[];
  /** Availability signal (`available > 0`) — Admin only (never sent to Client). */
  inStock?: boolean;
  /**
   * Units takeable RIGHT NOW — Admin only. Venta: the recorded stock (sales decrement
   * it). Alquiler: the fleet minus units out on active rentals (derived server-side).
   */
  available?: number;
  /**
   * The WHOLE rental fleet in circulation — Admin only, **Alquiler only** (absent for Venta,
   * where it would duplicate `available`): `available` + currently rented.
   */
  total?: number;
  /** Internal replacement cost — Admin only. */
  replacementPrice?: number;
  /** Catalog active flag — Admin only. */
  isActive?: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProductListResponse {
  products: Product[];
  pagination: Pagination;
}

/** `GET /products/:id` — the same role-projected shape as a list item, single row. */
export interface ProductDetailResponse {
  product: Product;
}

/** What `PUT /products/:id` did to the variations that left the body: those with order history were
 *  RETIRED (kept for the history), the rest deleted. Absent when none left. */
export interface ProductVariantOutcome {
  retired: { id: number; label: string }[];
  deleted: number;
}

/**
 * One tile of the catalog ARRANGEMENT (`GET|PUT /products/display-order`, Admin-only) — mirrors the
 * backend `ProductArrangementItemModel`. Deliberately tiny: the arrange page shows a photo, a name
 * and a category, nothing priced or stocked.
 */
export interface ProductArrangementItem {
  id: number;
  name: string;
  category: string;
  businessType: string;
  /** The primary photo (else the first one); absent when the product has no photos. */
  imageUrl?: string;
  /**
   * `false` = never arranged (`display_order` 0): a product created since the last arrangement,
   * which leads the catalog until the admin places it. Saving places every product.
   */
  placed: boolean;
}

/** `GET /products/display-order` and the `PUT`'s answer — every ACTIVE product, catalog order. */
export interface ProductArrangementResponse {
  products: ProductArrangementItem[];
}

/** A seeded lookup row (`GET /products/catalog`) — just enough to render a select option. */
export interface CatalogOption {
  id: number;
  name: string;
}

export interface CurrencyCatalogOption extends CatalogOption {
  iso4217Code: string;
  symbol: string;
}

/** Mirrors the backend `ProductCatalogResponseModel` — the create/edit form's reference data. */
export interface ProductCatalog {
  businessTypes: CatalogOption[];
  categories: CatalogOption[];
  currencies: CurrencyCatalogOption[];
  detailTypes: CatalogOption[];
  rentTimeUnits: CatalogOption[];
}
