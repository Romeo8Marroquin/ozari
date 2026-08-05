import type { Coords } from '@utils/geo';

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
  /**
   * What accepting this move does to the goods the order reserves — the ONLY thing a dialog may
   * claim about inventory. `release` gives units back, `reclaim` takes them again (so the move can
   * fail on availability), `none` leaves the reservation untouched. Derived server-side from the
   * statuses' `inventoryHold` plus the sale-stock rule, so the copy follows the machine: cancelling
   * an order that already finished correctly promises nothing.
   */
  inventoryEffect: OrderInventoryEffect;
  /** True when this move DESTROYS the photos of the step it undoes (a backward leg out of a step
   *  that demanded evidence) — warned about before it happens. */
  purgesEvidence: boolean;
  /** Which physical trip this move confirms, from the status's own `tracksEvent`. Non-null ⇒ the
   *  step is somebody DRIVING somewhere, which is exactly when a navigation button belongs beside
   *  it. `null` on every desk-work move (rewind, cancel) and on steps nobody travels for. */
  tracksEvent?: 'DELIVERY' | 'COLLECTION' | null;
}

/** @see OrderAction.inventoryEffect */
export type OrderInventoryEffect = 'release' | 'reclaim' | 'none';

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
  /** Does the order RESERVE anything right now (rental units held by its status, or sale units not
   *  yet cancelled/delivered)? The delete dialog states its inventory consequence from this instead
   *  of hedging — a finished or cancelled order gave its goods back long ago. */
  holdsInventory: boolean;
  paymentStatus: OrderLookup;
  /** Is the money in? Derived server-side from `paidAt`, never from a payment-status id — the
   *  "Registrar pago" action appears from THIS, so it can never disagree with the record. */
  isPaid: boolean;
  /** The delivery PIN — the one delivery snapshot the lean list carries, so the agenda offers
   *  navigation on the same rule as the detail. The address TEXT lives on the detail only. */
  deliveryCoords?: Coords;
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
  /** The saved map pin, when this address has one. Optional everywhere, forever. */
  coords?: Coords;
  /** Saved "how to get in" for this address — prefills the order, which then owns its own copy. */
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

/** One tracking photo, tagged with the step it documents. A step with none is normal: a rewind
 *  destroyed them, or the retention policy purged them — its history row still proves it happened. */
export interface OrderEvidence {
  id: number;
  statusId: number;
  url: string;
  at: string;
}

/** The full order the detail page and the create response share. */
export interface OrderDetail extends OrderListItem {
  /** The walk-in client registry this order belongs to — its IDENTITY, as opposed to the snapshot
   *  texts below. The edit form reopens on this client. */
  clientRegistryId?: number;
  deliveryContact: string;
  deliveryAddress: string;
  /** The delivery's map pin, snapshotted at order time. Absent = navigate by the address text. */
  deliveryCoords?: Coords;
  /** How to get in on arrival — the one delivery field the DRIVER reads rather than the admin. */
  deliveryInstructions?: string;
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
  evidence: OrderEvidence[];
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

/** The availability probe body — a delivery datetime, optional pickup, the product ids to check,
 *  and the DRIVER half: who would carry it, and (when editing) which order to exclude. */
export interface OrderAvailabilityBody {
  deliveryAt: string;
  pickupAt?: string;
  productIds: number[];
  /** Absent ⇒ the response carries no `driver` block (the assignee hasn't been chosen yet). */
  assignedUserId?: number;
  /** The order being edited — it already occupies its own blocks and must not conflict with itself. */
  excludeOrderId?: number;
}

/** One product's availability for the window: rentals = fleet minus held, sales = stock, `null` = a
 *  rental with no pickup window yet. */
export interface ProductAvailability {
  productId: number;
  available: number | null;
}

/** Which physical act a logistics event is. */
export type LogisticsEventKind = 'DELIVERY' | 'COLLECTION';

/**
 * One clash on the assigned driver's day: the OTHER order's event (`at`/`kind`) and WHICH of the
 * order being edited its block collides with (`blocks`) — so the message lands on the delivery or
 * the pickup input, not on both. Admin tier only.
 */
export interface DriverConflict {
  orderId: number;
  at: string;
  kind: LogisticsEventKind;
  blocks: LogisticsEventKind;
}

/**
 * Whether the assigned driver can actually be there — a different question from "do we have the
 * units", so it never reuses the stock conflict's shape or its fields. Everything but `available`
 * is Admin tier (a future client learns only that the slot is taken).
 */
export interface DriverAvailability {
  available: boolean;
  /** The configured minutes between two events — the copy formats this, never a hardcoded hour. */
  gapMinutes?: number;
  /** This order's own delivery and collection are too close together. */
  selfOverlap?: boolean;
  conflicts?: DriverConflict[];
  /** Who is already busy — read from HERE, never from the local catalog, so the probe's copy and
   *  the save's 409 can never name the driver differently. */
  driverName?: string;
}

export interface OrderAvailabilityResponse {
  availability: ProductAvailability[];
  /** Absent when the probe carried no assignee. */
  driver?: DriverAvailability;
}

/** The `data` of a create/edit `409` raised by the LOGISTICS PAD. Deliberately separate keys from
 *  the stock conflict's `conflicts`: they describe different problems and land on different fields. */
export interface OrderLogisticsConflictData {
  driverConflict?: DriverConflict & { driverName?: string; gapMinutes: number };
  selfOverlap?: { gapMinutes: number };
}
