/**
 * The product shapes returned by `GET /products`, **mirrored from the backend**
 * `ProductListItemResponseModel` (`ozari-api/src/modules/products/products.models.ts`). The list is
 * **role-projected**: the backend narrows the fields per role (minimum privilege), so the stock-related
 * fields below are **optional** — their mere presence IS the contract:
 *
 * - everyone (incl. Client) gets the shared catalog fields (name, price, images, …);
 * - **Employee** additionally gets `inStock` (an availability *signal*, never the count);
 * - **Admin** additionally gets the internal detail (`quantity`, `replacementPrice`, `isActive`).
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
  category: string;
  currency: ProductCurrency;
  /** Rental price per `rentTimeUnit`; absent for sale-only products. */
  rentPrice?: number;
  /** Outright sale price; absent for rent-only products. */
  sellPrice?: number;
  /** The rental period the `rentPrice` applies to (e.g. "Día"); present with `rentPrice`. */
  rentTimeUnit?: string;
  images: ProductImage[];
  details: ProductDetail[];
  /** Availability signal — Employee + Admin only (never sent to Client). */
  inStock?: boolean;
  /** Exact stock on hand — Admin only. */
  quantity?: number;
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
