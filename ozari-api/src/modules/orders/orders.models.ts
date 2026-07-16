import type { CurrencyModel } from "@/models/common/currencyModel.js";
import type {
  CatalogOptionModel,
  PaginationMeta,
} from "../products/products.models.js";

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
  status: OrderLookupModel;
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

/**
 * `GET /orders/:id` — everything the detail page needs on top of the list item: the decrypted
 * contact/address snapshots, the billed period, the money breakdown (delivery fee, deposit,
 * discount, payment), the lines/extras, and the status audit trail.
 */
export interface OrderDetailResponseModel extends OrderListItemResponseModel {
  /** Decrypted snapshots captured at order time (never live registry/user data). */
  deliveryContact: string;
  deliveryAddress: string;
  description: string | undefined;
  comment: string | undefined;
  /** The assigned driver (the admin is also a driver); absent while unassigned. */
  assignedUser: { id: number; name: string } | undefined;
  /** Fee actually charged for this delivery (admin-set, distance-based); absent = no fee. */
  deliveryAmount: number | undefined;
  /** Anticipo (partial deposit) recorded so far. */
  depositAmount: number | undefined;
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
  createdAt: Date;
}

export interface OrderListResponseModel {
  orders: OrderListItemResponseModel[];
  pagination: PaginationMeta;
}

/** An event type as the order form's select consumes it — the lead-time rides along. */
export interface EventTypeCatalogOptionModel extends CatalogOptionModel {
  minLeadHours: number;
}

/**
 * The reference data the orders section needs (`GET /orders/catalog`): every ACTIVE row of the
 * seeded lookups — event types (with their client lead-times), the status vocabularies for
 * filters/chips, and the contact types + zones the client-registry form consumes.
 */
export interface OrderCatalogResponseModel {
  eventTypes: EventTypeCatalogOptionModel[];
  serviceStatuses: CatalogOptionModel[];
  paymentStatuses: CatalogOptionModel[];
  contactTypes: CatalogOptionModel[];
  zones: CatalogOptionModel[];
}
