import type { Coords } from '@utils/geo';
import type { LogisticsEventKind, OrderCurrency, OrderListItem } from '../orders/order.types';

/**
 * One of the three things the admin has to act on next.
 *
 * It EXTENDS the order list item, which is the whole design: `actions`, `status` and `holdsInventory`
 * arrive from the same backend projection the agenda uses, so the quick action here and the one on a
 * ticket can never offer different moves. What the dashboard adds is the single EVENT this slot is
 * about, plus the delivery snapshots a driver needs to actually get there.
 */
export interface UpNextItem extends OrderListItem {
  event: {
    kind: LogisticsEventKind;
    at: string;
    /** Its time has passed and it still has not happened. */
    isOverdue: boolean;
    /** Whole minutes until `at`, negative once overdue. Computed SERVER-side against the payload's
     *  `generatedAt`, so a device with a skewed clock cannot disagree about what is late. */
    minutesUntil: number;
  };
  deliveryAddress: string;
  deliveryCoords?: Coords;
  deliveryInstructions?: string;
  deliveryContact: string;
}

/** A figure paired with the period before it. `deltaPercent` is ABSENT when the previous period was
 *  zero — the UI must render "sin comparación" rather than invent a percentage. */
export interface StatComparison {
  current: number;
  previous: number;
  deltaPercent?: number;
}

export interface RevenuePoint {
  /** `YYYY-MM` — a machine key; the client formats the visible label. */
  month: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  productId: number;
  name: string;
  quantity: number;
  revenue: number;
}

export interface StatusSlice {
  statusId: number;
  name: string;
  colorKey?: string;
  count: number;
}

export interface Dashboard {
  /** The instant every figure was computed at — the source for "actualizado hace…" and for every
   *  countdown on the screen. */
  generatedAt: string;
  upNext: UpNextItem[];
  today: {
    deliveries: number;
    collections: number;
    overdue: number;
    active: number;
  };
  month: {
    period: { from: string; to: string };
    revenue: StatComparison;
    orders: StatComparison;
    averageOrder: StatComparison;
    /** Orders CANCELLED this month — the one figure here reporting work LOST rather than done. */
    cancelled: StatComparison;
  };
  outstanding: {
    amount: number;
    orders: number;
  };
  revenueTrend: RevenuePoint[];
  topProducts: TopProduct[];
  statusSplit: StatusSlice[];
  currency: OrderCurrency;
}

export interface DashboardEnvelope {
  dashboard: Dashboard;
}
