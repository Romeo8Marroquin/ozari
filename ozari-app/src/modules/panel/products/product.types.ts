/**
 * The product shapes returned by `GET /products`, **mirrored from the backend**
 * `ProductListItemResponseModel` (`ozari-api/src/modules/products/products.models.ts`). The list is
 * **role-projected**: the backend narrows the fields per role (minimum privilege), so the stock-related
 * fields below are **optional** — their mere presence IS the contract:
 *
 * - everyone (incl. Client) gets the shared catalog fields (name, price, images, …);
 * - **Employee** additionally gets the availability: `inStock` AND the `available` count
 *   (a bare flag can't answer "can I take an order for 10?" — owner decision, 2026-07-14);
 * - **Admin** additionally gets the internal detail (`replacementPrice`, `isActive`) and — for
 *   Alquiler only — the fleet `total` alongside the available slice ("5 de 10 disponibles":
 *   an employee sees what can be taken, only the admin sees what the business OWNS).
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
  /** Rental price per `rentTimeUnit`; absent for sale-only products. */
  rentPrice?: number;
  /** Outright sale price; absent for rent-only products. */
  sellPrice?: number;
  /** The rental period the `rentPrice` applies to (e.g. "Día"); present with `rentPrice`. */
  rentTimeUnit?: string;
  /** Its lookup id (Alquiler only) — present alongside `rentTimeUnit`. */
  rentTimeUnitId?: number;
  images: ProductImage[];
  details: ProductDetail[];
  /** Availability signal (`available > 0`) — Employee + Admin only (never sent to Client). */
  inStock?: boolean;
  /**
   * Units takeable RIGHT NOW — Employee + Admin only. Venta: the recorded stock (sales decrement
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
