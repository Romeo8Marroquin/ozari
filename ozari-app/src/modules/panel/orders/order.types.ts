/** A lookup pair as the backend projects it on an order (id + display name). */
export interface OrderLookup {
  id: number;
  name: string;
}

export interface OrderCurrency {
  id: number;
  iso4217Code: string;
  name: string;
  symbol: string;
}

/**
 * An order as `GET /orders` returns it (the Admin list projection — lean on purpose: the
 * PII-heavier snapshots and the money breakdown live on the detail endpoint). Dates arrive as ISO
 * strings; `pickupAt` is absent on purchase-only orders, and the tracking timestamps appear as
 * their steps are confirmed.
 */
export interface OrderListItem {
  id: number;
  /** Decrypted snapshot of the responsible person captured at order time. */
  clientName: string;
  /** True when the order belongs to a walk-in client registry rather than a platform user. */
  isRegistryClient: boolean;
  eventType: OrderLookup;
  status: OrderLookup;
  paymentStatus: OrderLookup;
  deliveryAt: string;
  pickupAt?: string;
  deliveredAt?: string;
  collectedAt?: string;
  readyAt?: string;
  cancelledAt?: string;
  /** Total units across the order's active lines. */
  itemCount: number;
  totalAmount: number;
  currency: OrderCurrency;
}

export interface OrderListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrderListResponse {
  orders: OrderListItem[];
  pagination: OrderListPagination;
}
