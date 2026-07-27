/** A lookup pair as the backend projects it on an order (id + display name). */
export interface OrderLookup {
  id: number;
  name: string;
}

/** The order's current lifecycle status, carrying the chip tone TOKEN the admin configured (see
 *  `statusTone.ts` for the token → classes map). Absent `colorKey` renders neutral. */
export interface OrderStatusRef extends OrderLookup {
  colorKey?: string;
}

/** The three shapes a lifecycle move can take: `forward`/`backward` walk the pipeline,
 *  `disruptive` is the any-time exit (cancel). */
export type OrderActionKind = 'forward' | 'backward' | 'disruptive';

/**
 * One move the CURRENT user may make on an order, as the backend's lifecycle engine offers it —
 * already narrowed by role and assignment, and already carrying what the UI must collect first
 * (photos, a reason). Buttons render straight from this: the frontend keeps no transition rules,
 * no id switch and no permission logic of its own.
 */
export interface OrderAction {
  kind: OrderActionKind;
  statusId: number;
  statusName: string;
  colorKey?: string;
  requiresEvidence: boolean;
  /** Resolved photo bounds (per-status override merged with the global preference). */
  minEvidence: number;
  maxEvidence: number;
  /** Disruptive moves record a reason. */
  requiresReason: boolean;
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
  status: OrderStatusRef;
  /** The MODE-AWARE next pipeline step (a purchase-only order never walks the rental-only ones);
   *  absent once the order is finished or cancelled. Informational — permission lives in `actions`. */
  nextStatus?: OrderLookup;
  /** Every move THIS user may make right now. Empty on another worker's order, on a finished one,
   *  or for a role without rights. */
  actions: OrderAction[];
  paymentStatus: OrderLookup;
  deliveryAt: string;
  pickupAt?: string;
  deliveredAt?: string;
  collectedAt?: string;
  readyAt?: string;
  cancelledAt?: string;
  /** The assigned driver (the admin is also a driver); absent while unassigned ("Sin asignar"). */
  assignee?: { id: number; name: string };
  /** True when the order is assigned to the requesting user — the agenda groups MINE vs the rest
   *  and shows the per-order quick action only on `isMine` tickets. */
  isMine: boolean;
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

/** A staff member an order can be assigned to (the deliverable roles — Admin + Driver today). The
 *  create form's "Asignar a" select consumes these; `role` (display name) rides along to disambiguate. */
export interface AssignableUser {
  id: number;
  name: string;
  role: string;
}

/**
 * A lifecycle status as `GET /orders/catalog` publishes it: the lookup PLUS its declared behavior,
 * so filters can read in pipeline order and the admin screen can edit the machine. Evidence counts
 * arrive RESOLVED (per-status override already merged with the global preference).
 */
export interface OrderStatusCatalogOption extends CatalogOption {
  /** Pipeline position; absent on a disruptive off-ramp (Cancelado). */
  sortOrder?: number;
  isInitial: boolean;
  isDisruptive: boolean;
  /** `NONE` | `WINDOW` | `OUT` — how a rental line here affects the fleet. */
  inventoryHold: string;
  requiresEvidence: boolean;
  minEvidence: number;
  maxEvidence: number;
  /** `ALL` | `RENTAL` | `SALE` — which order modes walk this step. */
  appliesTo: string;
  /** `DELIVERY` | `COLLECTION` — the actual this step stamps; absent = none. */
  tracksEvent?: string;
  colorKey?: string;
}

export interface OrderCatalog {
  eventTypes: EventTypeCatalogOption[];
  /** Pipeline order first, the off-ramps last — as the backend sorts them. */
  serviceStatuses: OrderStatusCatalogOption[];
  paymentStatuses: CatalogOption[];
  paymentMethods: CatalogOption[];
  contactTypes: CatalogOption[];
  zones: ZoneOption[];
  assignableUsers: AssignableUser[];
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

// ── Live availability (`POST /orders/availability`) ──────────────────────────────────────────────

/** The availability probe body — a delivery datetime, optional pickup, and the product ids to check. */
export interface OrderAvailabilityBody {
  deliveryAt: string;
  pickupAt?: string;
  productIds: number[];
}

/** One product's availability for the window: rentals = fleet minus held, sales = stock, `null` = a
 *  rental with no pickup window yet. */
export interface ProductAvailability {
  productId: number;
  available: number | null;
}

export interface OrderAvailabilityResponse {
  availability: ProductAvailability[];
}
