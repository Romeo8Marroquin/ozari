/**
 * The two presentation views of the orders screen. The URL speaks Spanish (`?view=historial`, a
 * shareable/refresh-safe segmented-control state); the backend's `view` param speaks English —
 * `toApiView` is the single translation point.
 */
export type OrdersView = 'agenda' | 'historial';

/** The segmented control's option order (also the tabs' arrow-key order). */
export const ORDERS_VIEWS: readonly OrdersView[] = ['agenda', 'historial'];

/** The parsed `/panel/pedidos` search: only the non-default view is ever written to the URL. */
export interface OrdersSearch {
  view?: 'historial';
}

/**
 * Clamp-never-reject (the products filters' stance): anything other than the exact `historial`
 * marker — absent, misspelled, the default spelled out — parses to the default agenda (an empty
 * search object, so the default URL stays clean).
 */
export function parseOrdersSearch(search: Record<string, unknown>): OrdersSearch {
  return search['view'] === 'historial' ? { view: 'historial' } : {};
}

/** The view a parsed search selects (absent ⇒ agenda). */
export function activeOrdersView(search: OrdersSearch): OrdersView {
  return search.view ?? 'agenda';
}

/** The backend `view` query value for a UI view. */
export function toApiView(view: OrdersView): 'agenda' | 'history' {
  return view === 'historial' ? 'history' : 'agenda';
}
