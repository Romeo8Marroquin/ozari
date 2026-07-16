/**
 * The catalog's filter state, carried in the `/panel/productos` **URL search params** (owner
 * decision, 2026-07-14) so a filtered view survives refresh, honours the back button, and can be
 * shared as a link. `parseProductListSearch` is the route's `validateSearch`: it mirrors the
 * backend's clamp-never-reject stance (`parseProductListQuery`) — a bad value silently DROPS OUT
 * instead of erroring, so a hand-edited URL can never break the page. Param names are user-facing
 * Spanish (they appear in the address bar), mapped to the API's names in {@link toProductListParams}.
 */

/** Longest search string honoured — mirrors the backend `maxProductSearchLength`. */
export const PRODUCT_SEARCH_MAX_LENGTH = 100;

/**
 * The user-facing (URL) sort values, mapped to the API's `sort` in {@link toProductListParams}.
 * The default — newest first — is represented by the param's ABSENCE, like every other filter.
 * There is deliberately no availability filter (owner decision, 2026-07-15): "available" means
 * different things per role (an admin NEEDS to see unavailable rows; a rented-out Alquiler may
 * free up tomorrow), so ordering replaced it.
 */
export const PRODUCT_LIST_ORDERS = [
  'nombre-az',
  'nombre-za',
  'precio-menor',
  'precio-mayor',
] as const;

export type ProductListOrder = (typeof PRODUCT_LIST_ORDERS)[number];

/** URL order value → the API's `sort` query param. */
const ORDER_TO_SORT: Record<ProductListOrder, string> = {
  'nombre-az': 'nameAsc',
  'nombre-za': 'nameDesc',
  'precio-menor': 'priceAsc',
  'precio-mayor': 'priceDesc',
};

export interface ProductListSearch {
  /** Name search (case-insensitive substring, resolved server-side). */
  q?: string;
  /** Category id (`GET /products/catalog` → `categories`). */
  categoria?: number;
  /** Business type id (Alquiler/Venta). */
  tipo?: number;
  /** Presentation order; absent = newest first (the default). */
  orden?: ProductListOrder;
}

/** A positive integer (number or numeric string) or undefined — the filter drops out otherwise. */
function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** Route `validateSearch`: normalize whatever is in the URL into a safe {@link ProductListSearch}. */
export function parseProductListSearch(input: Record<string, unknown>): ProductListSearch {
  const search: ProductListSearch = {};

  const q = typeof input['q'] === 'string' ? input['q'].trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH) : '';
  if (q !== '') search.q = q;

  const categoria = parsePositiveInt(input['categoria']);
  if (categoria !== undefined) search.categoria = categoria;

  const tipo = parsePositiveInt(input['tipo']);
  if (tipo !== undefined) search.tipo = tipo;

  const orden = PRODUCT_LIST_ORDERS.find((value) => value === input['orden']);
  if (orden !== undefined) search.orden = orden;

  return search;
}

/** Whether any filter/order is active — drives the "clear filters" affordance and the filtered-empty state. */
export function hasActiveFilters(search: ProductListSearch): boolean {
  return (
    search.q !== undefined ||
    search.categoria !== undefined ||
    search.tipo !== undefined ||
    search.orden !== undefined
  );
}

/** Map the URL shape to the `GET /products` query params (absent filters stay absent). */
export function toProductListParams(search: ProductListSearch): Record<string, string | number | boolean> {
  return {
    ...(search.q !== undefined ? { search: search.q } : {}),
    ...(search.categoria !== undefined ? { categoryId: search.categoria } : {}),
    ...(search.tipo !== undefined ? { businessTypeId: search.tipo } : {}),
    ...(search.orden !== undefined ? { sort: ORDER_TO_SORT[search.orden] } : {}),
  };
}
