import type { CurrencyModel } from "@/models/common/currencyModel.js";
import type {
  CatalogOptionModel,
  PaginationMeta,
  ZoneCatalogOptionModel,
} from "../products/products.models.js";
import type { OrderActionModel } from "./lifecycle/lifecycle.models.js";
import type { DriverAvailabilityModel } from "./logistics/logistics.models.js";

/**
 * The two presentation views of the order list (the frontend's segmented control):
 * - `agenda` — every order that is still WORK: upcoming, en route, delivered-awaiting-pickup, and
 *   collected-awaiting-the-explicit-"listo" press. Soonest delivery first (the day-grouped agenda).
 * - `history` — finished (`readyAt` set) or cancelled orders, newest delivery first.
 */
export type OrderListViewModel = "agenda" | "history";

/**
 * The parsed `GET /orders` query — pagination + the view + an optional status filter. Produced by
 * `parseOrderListQuery` under the clamp-never-reject stance (same as products): bad pagination
 * falls back, an unknown view clamps to `agenda`, a bad status filter drops out.
 */
export interface OrderListQueryModel {
  page: number;
  pageSize: number;
  view: OrderListViewModel;
  /** Optional `service_status` id filter within the view; absent when not filtering. */
  statusId: number | undefined;
}

/** A lookup pair as projected on an order (id + display name). */
export interface OrderLookupModel {
  id: number;
  name: string;
}

/** The order's CURRENT status, carrying its chip tone token so the client renders the colour the
 *  admin configured (never a client-side id→colour map). `colorKey` is absent when unset. */
export interface OrderStatusRefModel extends OrderLookupModel {
  colorKey: string | undefined;
}

/**
 * An order as the AGENDA/HISTORY list renders it — deliberately lean: what the admin needs at a
 * glance (who, what kind of event, where it stands, when, how big, how much). The PII-heavier
 * snapshots (contact, address) and the money breakdown live on the detail response only.
 */
export interface OrderListItemResponseModel {
  id: number;
  /** Decrypted `delivery_name_kms` snapshot — the responsible person captured at order time. */
  clientName: string;
  /** True when the order belongs to a walk-in client registry rather than a platform user. */
  isRegistryClient: boolean;
  eventType: OrderLookupModel;
  status: OrderStatusRefModel;
  /** The MODE-AWARE next pipeline step (a purchase-only order never sees the rental-only ones), or
   *  absent when the order is finished/cancelled. Informational — what WOULD come next; whether the
   *  viewer may take it is `actions`. */
  nextStatus: OrderLookupModel | undefined;
  /** Every move the REQUESTING actor may make right now (forward / backward / cancel), each already
   *  carrying its evidence + reason requirements. The client renders its buttons straight from this
   *  — no lifecycle rule is duplicated there, and a role can never see an action it may not take. */
  actions: OrderActionModel[];
  /**
   * Does the order RESERVE anything right now — rental units held by its current status, or sale
   * units not yet cancelled/delivered? Derived from the lifecycle flags, never stored.
   *
   * It exists so a client can state a consequence instead of hedging: deleting an order that holds
   * goods returns them, deleting one that finished or was cancelled changes no inventory at all
   * (those units went back when it reached that state). Both sentences are true only if the UI is
   * told which one applies.
   */
  holdsInventory: boolean;
  paymentStatus: OrderLookupModel;
  deliveryAt: Date;
  /** Absent = purchase-only order (no pickup event — Q-A, 2026-07-16). */
  pickupAt: Date | undefined;
  /** Tracking actuals — absent until the corresponding step is confirmed. */
  deliveredAt: Date | undefined;
  collectedAt: Date | undefined;
  /** The explicit final "listo" press that returned the units to the fleet. */
  readyAt: Date | undefined;
  cancelledAt: Date | undefined;
  /** The assigned driver (the admin is also a driver); absent while unassigned ("Sin asignar"). */
  assignee: { id: number; name: string } | undefined;
  /** True when this order is assigned to the requesting user — the agenda groups MINE vs the rest
   *  and only shows the per-order quick action on `isMine` rows (never on another worker's order). */
  isMine: boolean;
  /** Total units across the order's active lines. */
  itemCount: number;
  totalAmount: number;
  currency: CurrencyModel;
}

/** One order line (an active `service_details` row) as the detail page renders it. */
export interface OrderLineResponseModel {
  id: number;
  productId: number;
  productName: string;
  /** The line's rent-vs-sale snapshot (how it was ordered, immune to later product edits). */
  isRental: boolean;
  quantity: number;
  unitaryPrice: number;
  parcialPrice: number;
}

/** One ad-hoc extra (an active `service_extras` row) — every money field may be absent. */
export interface OrderExtraResponseModel {
  id: number;
  name: string;
  description: string | undefined;
  quantity: number | undefined;
  unitaryPrice: number | undefined;
  parcialPrice: number | undefined;
}

/** One status transition from the append-only audit trail (`service_status_history`). */
export interface OrderStatusHistoryResponseModel {
  id: number;
  /** Absent on the creation row (there was no previous status). */
  from: OrderLookupModel | undefined;
  to: OrderLookupModel;
  /** Decrypted full name of the user who moved the order. */
  byUserName: string;
  at: Date;
}

/** One tracking photo, tagged with the step it documents. */
export interface OrderEvidenceResponseModel {
  id: number;
  statusId: number;
  url: string;
  at: Date;
}

/**
 * `GET /orders/:id` — everything the detail page needs on top of the list item: the decrypted
 * contact/address snapshots, the billed period, the money breakdown (delivery fee, deposit,
 * discount, payment), the lines/extras, and the status audit trail.
 */
export interface OrderDetailResponseModel extends OrderListItemResponseModel {
  /** The walk-in client registry this order belongs to — the IDENTITY, as opposed to the snapshot
   *  texts below. Absent on the (future) platform-user variant. The edit form needs it to reopen on
   *  the right client; the list projection deliberately doesn't carry it (nothing there uses it). */
  clientRegistryId: number | undefined;
  /** Decrypted snapshots captured at order time (never live registry/user data). */
  deliveryContact: string;
  deliveryAddress: string;
  description: string | undefined;
  comment: string | undefined;
  /** Fee actually charged for this delivery (admin-set, distance-based); absent = no fee. */
  deliveryAmount: number | undefined;
  /** Anticipo (partial deposit) recorded so far. */
  depositAmount: number | undefined;
  /** How the order is paid (Efectivo / Transferencia); absent until chosen. */
  paymentMethod: OrderLookupModel | undefined;
  discountAmount: number | undefined;
  discountReason: string | undefined;
  paidAt: Date | undefined;
  cancelReason: string | undefined;
  /** The BILLED period (whole days derived from the delivery→pickup window). */
  serviceStart: Date;
  serviceEnd: Date;
  lines: OrderLineResponseModel[];
  extras: OrderExtraResponseModel[];
  statusHistory: OrderStatusHistoryResponseModel[];
  /** Tracking photos, each tagged with the step it documents (the detail page groups by `statusId`).
   *  Absent entries are normal: a rewound step drops its photos, and old evidence is purged by the
   *  retention policy — the step is still proven by its history row. */
  evidence: OrderEvidenceResponseModel[];
  createdAt: Date;
}

export interface OrderListResponseModel {
  orders: OrderListItemResponseModel[];
  pagination: PaginationMeta;
}

/** The `GET /orders/:id` payload envelope (mirrors products' `{ product: … }` convention). */
export interface OrderDetailEnvelopeModel {
  order: OrderDetailResponseModel;
}

/** An event type as the order form's select consumes it — the lead-time rides along. */
export interface EventTypeCatalogOptionModel extends CatalogOptionModel {
  minLeadHours: number;
}

/**
 * A staff member an order can be ASSIGNED to — the "deliverable" roles (**Admin + Driver** today;
 * the set widens as more delivering roles land, in ONE place: `ASSIGNABLE_ROLES`). The create form's
 * "Asignar a" select consumes these, defaulting to the creating admin. `role` (the role's display
 * name) rides along so the picker can disambiguate people and future UIs can group by role.
 */
export interface AssignableUserModel {
  id: number;
  name: string;
  role: string;
}

/**
 * A lifecycle status as the catalog publishes it — the seeded lookup PLUS its declared behavior, so
 * the client can render tones, order the filter chips like the real pipeline, and know what a step
 * will demand before offering it. Evidence counts are RESOLVED (per-status override already merged
 * with the global preference), so no consumer needs the globals. Pipeline steps carry `sortOrder`;
 * disruptive off-ramps (Cancelado) leave it absent.
 */
export interface OrderStatusCatalogOptionModel extends CatalogOptionModel {
  sortOrder: number | undefined;
  isInitial: boolean;
  isDisruptive: boolean;
  /** `NONE` | `WINDOW` | `OUT` — how a rental line in this status affects the fleet. */
  inventoryHold: string;
  requiresEvidence: boolean;
  minEvidence: number;
  maxEvidence: number;
  /** `ALL` | `RENTAL` | `SALE` — which order modes walk this step. */
  appliesTo: string;
  /** `DELIVERY` | `COLLECTION` — the actual this step stamps; absent when it tracks none. */
  tracksEvent: string | undefined;
  colorKey: string | undefined;
}

/**
 * The reference data the orders section needs (`GET /orders/catalog`): every ACTIVE row of the
 * seeded lookups — event types (with their client lead-times), the status vocabularies for
 * filters/chips, and the contact types + zones the client-registry form consumes.
 */
export interface OrderCatalogResponseModel {
  eventTypes: EventTypeCatalogOptionModel[];
  /** The lifecycle statuses, pipeline order first then the off-ramps, each with its flags. */
  serviceStatuses: OrderStatusCatalogOptionModel[];
  paymentStatuses: CatalogOptionModel[];
  /** How an order is paid — Efectivo / Transferencia (owner 2026-07-23; card door open). */
  paymentMethods: CatalogOptionModel[];
  contactTypes: CatalogOptionModel[];
  /** Each zone carries its default `deliveryFee` (the order form's fee suggestion). */
  zones: ZoneCatalogOptionModel[];
  /** The staff the order can be assigned to (deliverable roles) — the "Asignar a" select options. */
  assignableUsers: AssignableUserModel[];
}

/** One requested order line — the server derives EVERYTHING else (rent-vs-sale, prices) from the
 *  product row at creation time; a client-sent price is never trusted. */
export interface CreateOrderLineRequestModel {
  productId: number;
  quantity: number;
}

/**
 * `POST /orders` — the admin's order-on-behalf creation (the WhatsApp/phone flow). Identity is a
 * **client registry** (walk-in client) — the ONLY variant mounted today. The platform-user variant
 * (`userId` instead of `clientRegistryId`, for the admin creating on behalf of a registered
 * client, and later the client's own self-service flow) is a DOCUMENTED DOOR: it reuses this exact
 * shape + machinery and only widens the identity validation — never a second endpoint.
 *
 * The delivery snapshot fields (`deliveryName`/`deliveryContact`/`deliveryAddress`) arrive as
 * TEXT: the form prefills them from the chosen registry (or the admin types a one-off venue —
 * parties rarely happen at the client's home address), and the order records what was actually
 * agreed (the snapshot doctrine). Dates are parsed to `Date` by the validator.
 */
export interface CreateOrderRequestModel {
  clientRegistryId: number;
  eventTypeId: number;
  deliveryAt: Date;
  /** Required when the order carries ANY rental line; forbidden for a purchase-only order (Q-A). */
  pickupAt: Date | undefined;
  deliveryName: string;
  deliveryContact: string;
  deliveryAddress: string;
  description: string | undefined;
  comment: string | undefined;
  /** Delivery fee actually charged — admin-set, distance-based (free inside Hacienda Real). */
  deliveryAmount: number | undefined;
  /** Anticipo (partial deposit) taken at creation, when any. */
  depositAmount: number | undefined;
  /** How it will be paid (an active seeded method); optional — payment can be settled later. */
  paymentMethodId: number | undefined;
  /**
   * The staff member the order is assigned to (an active Admin/Driver) — **required** (Q-D2, owner
   * decision 2026-07-30). The column is nullable and the API used to default it to the creating
   * admin, which made "unassigned" a state that could not happen but was still modelled. Since the
   * logistics pad is a rule about a DRIVER's day, every event needs an owner: requiring it at the
   * validator deletes the ambiguity instead of modelling it.
   */
  assignedUserId: number;
  lines: CreateOrderLineRequestModel[];
}

/** One line the requested window cannot satisfy — the 409 payload the form renders (EPIC-2 §8). */
export interface OrderStockConflictItemModel {
  productId: number;
  productName: string;
  requested: number;
  /** Units actually takeable for the requested window (rentals) or remaining stock (sales). */
  available: number;
}

/**
 * `POST /orders/availability` — the ADMIN's live per-window availability probe (EPIC-2 §10.C/§11.B):
 * the order form calls it when the delivery/pickup window is set so the product picker can annotate
 * each product's takeable amount and reconcile already-picked lines. Admin gets EXACT counts (they
 * run the business — see §11.A); a future CLIENT tier returns only a capped orderable amount.
 */
export interface OrderAvailabilityRequestModel {
  deliveryAt: Date;
  /** Absent = no rental window yet — rentals return `null` (unknown until a pickup is set). */
  pickupAt: Date | undefined;
  productIds: number[];
  /** The driver the order would be assigned to. Absent ⇒ the `driver` block is omitted entirely —
   *  the form simply has nothing to say yet, and nagging about a field the admin has not reached
   *  is worse than silence (EPIC-2-DRIVER-AVAILABILITY §4.4). */
  assignedUserId: number | undefined;
  /** The order being EDITED, excluded from the driver check: it already holds its own two events
   *  and would otherwise always report a conflict with itself. */
  excludeOrderId: number | undefined;
}

/** One product's availability for the requested window. */
export interface ProductAvailabilityModel {
  productId: number;
  /** Rentals: fleet minus what's held in the window; sales: current stock. `null` = a rental with
   *  no pickup window yet (can't be computed until a pickup is chosen). */
  available: number | null;
}

export interface OrderAvailabilityResponseModel {
  availability: ProductAvailabilityModel[];
  /**
   * Whether the assigned DRIVER can actually be there — a different question from "do we have the
   * units", answered on the same keystroke because the form needs both. Absent when no
   * `assignedUserId` was sent. Always shaped by `projectDriverAvailability`, never inline.
   */
  driver?: DriverAvailabilityModel;
}
