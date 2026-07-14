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
  /** "As-new" value billed for a lost/damaged rental. Optional, but always captured when given. */
  replacementPrice: number | undefined;
  /** Required when `businessTypeId` = Venta; forbidden for Alquiler. */
  sellPrice: number | undefined;
}

export interface UpdateProductDetailRequestModel extends CreateProductDetailRequestModel {
  id: number;
}

export interface UpdateProductRequestModel extends CreateProductRequestModel {
  id: number;
  productDetails: UpdateProductDetailRequestModel[];
}

export interface BaseProductDetailsResponseModel {
  detail: string;
  detailType: string;
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
 * `inStock`/`quantity`/`replacementPrice`/`isActive` fields are **role-gated** — present only for the
 * roles allowed to see them (see `projectProductForRole`), so they are optional here.
 */
export interface ProductListItemResponseModel {
  id: number;
  name: string;
  description: string | undefined;
  businessType: string;
  category: string;
  currency: CurrencyModel;
  rentPrice: number | undefined;
  sellPrice: number | undefined;
  /** The period `rentPrice` is quoted against (Alquiler only), e.g. "Día". */
  rentTimeUnit: string | undefined;
  images: ProductImageResponseModel[];
  details: BaseProductDetailsResponseModel[];
  /** Availability signal (Employee + Admin). */
  inStock?: boolean;
  /** Exact total stock (Admin only). */
  quantity?: number;
  /** "As-new" replacement value (Admin only; may itself be absent on a product). */
  replacementPrice?: number | undefined;
  /** Soft-delete flag (Admin only). */
  isActive?: boolean;
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
