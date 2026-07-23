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

// ── Reference data (`GET /orders/catalog`) ───────────────────────────────────────────────────

export interface CatalogOption {
  id: number;
  name: string;
}

/** An event type as the order form's select consumes it — the client lead-time rides along. */
export interface EventTypeCatalogOption extends CatalogOption {
  minLeadHours: number;
}

/** A zone carrying its default delivery fee (zones drive fee pricing; `deliveryFee` absent = not
 *  configured, distinct from 0 = free). */
export interface ZoneOption extends CatalogOption {
  deliveryFee?: number;
}

export interface OrderCatalog {
  eventTypes: EventTypeCatalogOption[];
  serviceStatuses: CatalogOption[];
  paymentStatuses: CatalogOption[];
  paymentMethods: CatalogOption[];
  contactTypes: CatalogOption[];
  zones: ZoneOption[];
}

// ── Client registries (the walk-in client picker; `GET`/`POST /client-registries`) ───────────

export interface RegistryContact {
  id: number;
  contactType: CatalogOption;
  value: string;
  isPrincipal: boolean;
}

export interface RegistryAddress {
  id: number;
  zone?: ZoneOption;
  address: string;
  instructions?: string;
  domicilePrice?: number;
  isFavorite: boolean;
}

export interface ClientRegistry {
  id: number;
  name: string;
  notes?: string;
  contacts: RegistryContact[];
  addresses: RegistryAddress[];
  /** The client's default payment method — pre-selects the order's method. */
  preferredPaymentMethod?: CatalogOption;
  createdAt: string;
}

export interface ClientRegistryListResponse {
  registries: ClientRegistry[];
  pagination: OrderListPagination;
}

/** `POST /client-registries` response envelope. */
export interface ClientRegistryEnvelope {
  registry: ClientRegistry;
}

// ── Order detail (`GET /orders/{id}` and the `POST /orders` response) ─────────────────────────

export interface OrderLine {
  id: number;
  productId: number;
  productName: string;
  isRental: boolean;
  quantity: number;
  unitaryPrice: number;
  parcialPrice: number;
}

export interface OrderStatusChange {
  id: number;
  from?: OrderLookup;
  to: OrderLookup;
  byUserName: string;
  at: string;
}

/** The full order the detail page and the create response share. */
export interface OrderDetail extends OrderListItem {
  deliveryContact: string;
  deliveryAddress: string;
  description?: string;
  comment?: string;
  assignedUser?: { id: number; name: string };
  deliveryAmount?: number;
  depositAmount?: number;
  paymentMethod?: OrderLookup;
  discountAmount?: number;
  discountReason?: string;
  paidAt?: string;
  cancelReason?: string;
  serviceStart: string;
  serviceEnd: string;
  lines: OrderLine[];
  extras: unknown[];
  statusHistory: OrderStatusChange[];
  createdAt: string;
}

export interface OrderDetailEnvelope {
  order: OrderDetail;
}

/** One line the requested window can't satisfy — the `data.conflicts` in the create 409. */
export interface OrderStockConflictItem {
  productId: number;
  productName: string;
  requested: number;
  available: number;
}
