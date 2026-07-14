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

export interface ProductListSearch {
  /** Name search (case-insensitive substring, resolved server-side). */
  q?: string;
  /** Category id (`GET /products/catalog` → `categories`). */
  categoria?: number;
  /** Business type id (Alquiler/Venta). */
  tipo?: number;
  /** Availability — Employee/Admin only; the backend silently ignores it for a Client. */
  stock?: boolean;
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

  const stock = input['stock'];
  if (stock === true || stock === 'true') search.stock = true;
  else if (stock === false || stock === 'false') search.stock = false;

  return search;
}

/** Whether any filter is active — drives the "clear filters" affordance and the filtered-empty state. */
export function hasActiveFilters(search: ProductListSearch): boolean {
  return (
    search.q !== undefined ||
    search.categoria !== undefined ||
    search.tipo !== undefined ||
    search.stock !== undefined
  );
}

/** Map the URL shape to the `GET /products` query params (absent filters stay absent). */
export function toProductListParams(search: ProductListSearch): Record<string, string | number | boolean> {
  return {
    ...(search.q !== undefined ? { search: search.q } : {}),
    ...(search.categoria !== undefined ? { categoryId: search.categoria } : {}),
    ...(search.tipo !== undefined ? { businessTypeId: search.tipo } : {}),
    ...(search.stock !== undefined ? { inStock: search.stock } : {}),
  };
}
