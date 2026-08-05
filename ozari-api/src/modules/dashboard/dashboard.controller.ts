import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { statusById } from "../orders/lifecycle/lifecycle.service.js";
import { loadOrderProjectionContext } from "../orders/orders.service.js";
import type {
  DashboardCurrencyModel,
  DashboardEnvelopeModel,
  StatusSliceModel,
  TopProductModel,
} from "./dashboard.models.js";
import {
  TOP_PRODUCTS_LIMIT,
  TREND_MONTHS,
  UP_NEXT_LIMIT,
  bucketRevenueByMonth,
  compare,
  dashboardOrderInclude,
  dayRange,
  monthRange,
  nextPendingEvent,
  outstandingFrom,
  projectUpNextItem,
  round2,
  selectUpNext,
} from "./dashboard.service.js";

/** A cancelled order is not business — it never counts toward revenue, volume or workload. */
const LIVE = { cancelledAt: null, isActive: true } as const;

/**
 * `GET /dashboard` — the admin's home screen, computed in ONE round trip.
 *
 * **Every query below runs in the same `Promise.all`.** That is the whole performance design: on a
 * scale-to-zero backend, six sequential aggregates cost six round trips on top of a cold start,
 * which is exactly how a dashboard earns a reputation for being slow. Nothing here awaits anything
 * else, and nothing here is per-row — the lifecycle catalog is memoized and threaded in.
 *
 * The up-next queue is deliberately TWO narrow indexed queries rather than one clever one: an
 * order's next pending event is its delivery if it hasn't been delivered, otherwise its collection,
 * and those are two different columns with two different indexes (`@@index([deliveryAt])`,
 * `@@index([pickupAt])`). Each candidate order matches exactly one of the two sets, so taking the
 * first `UP_NEXT_LIMIT` of each and merging is not an approximation — it is exact, and it never
 * scans the table. Ordering by `deliveryAt` alone would have been an approximation.
 */
export const getDashboard = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    // ONE instant for the entire payload: every countdown, every "overdue", every period boundary is
    // derived from this, so the screen can never show figures from two different moments.
    const now = new Date();
    const today = dayRange(now);
    const thisMonth = monthRange(now);
    const lastMonth = monthRange(now, -1);
    const trendFrom = monthRange(now, -(TREND_MONTHS - 1)).from;

    const inRange = (from: Date, to: Date) => ({ gte: from, lt: to });
    const monthAggregate = (from: Date, to: Date) =>
      prismaClient.service.aggregate({
        where: { ...LIVE, deliveryAt: inRange(from, to) },
        _sum: { totalAmount: true },
        _count: { _all: true },
      });

    const [
      context,
      pendingDeliveries,
      pendingCollections,
      deliveriesToday,
      collectionsToday,
      overdueDeliveries,
      overdueCollections,
      activeOrders,
      currentMonth,
      previousMonth,
      cancelledThisMonth,
      cancelledLastMonth,
      trendRows,
      unpaidRows,
      topProductRows,
      statusRows,
      latestCurrency,
    ] = await Promise.all([
      // The actor context (lifecycle catalog + evidence bounds) — so `actions` on every up-next card
      // comes from the engine, already narrowed to this admin.
      loadOrderProjectionContext({
        userId: req.user?.userId ?? 0,
        role: req.user?.userRole ?? RolesEnum.Admin,
      }),
      // Next event = DELIVERY: not yet delivered.
      prismaClient.service.findMany({
        where: { ...LIVE, deliveredAt: null },
        orderBy: { deliveryAt: "asc" },
        take: UP_NEXT_LIMIT,
        include: dashboardOrderInclude,
      }),
      // Next event = COLLECTION: delivered, has a pickup, not yet collected.
      prismaClient.service.findMany({
        where: {
          ...LIVE,
          deliveredAt: { not: null },
          collectedAt: null,
          pickupAt: { not: null },
        },
        orderBy: { pickupAt: "asc" },
        take: UP_NEXT_LIMIT,
        include: dashboardOrderInclude,
      }),
      prismaClient.service.count({
        where: { ...LIVE, deliveryAt: inRange(today.from, today.to) },
      }),
      prismaClient.service.count({
        where: { ...LIVE, pickupAt: inRange(today.from, today.to) },
      }),
      // "Overdue" is measured against the ACTUALS, never a status id — the same rule the logistics
      // pad uses, so a corrected rewind puts an order back on this count by itself.
      prismaClient.service.count({
        where: { ...LIVE, deliveredAt: null, deliveryAt: { lt: now } },
      }),
      prismaClient.service.count({
        where: {
          ...LIVE,
          deliveredAt: { not: null },
          collectedAt: null,
          pickupAt: { lt: now },
        },
      }),
      prismaClient.service.count({ where: { ...LIVE, readyAt: null } }),
      monthAggregate(thisMonth.from, thisMonth.to),
      monthAggregate(lastMonth.from, lastMonth.to),
      // CANCELLED orders, scoped by delivery date like every other monthly figure. They are excluded
      // from `LIVE` everywhere else — which is right for revenue and for "in progress", but it left
      // them invisible on the whole screen. A cancellation IS business information: it is the one
      // number here that says work was lost rather than done.
      prismaClient.service.count({
        where: {
          isActive: true,
          cancelledAt: { not: null },
          deliveryAt: inRange(thisMonth.from, thisMonth.to),
        },
      }),
      prismaClient.service.count({
        where: {
          isActive: true,
          cancelledAt: { not: null },
          deliveryAt: inRange(lastMonth.from, lastMonth.to),
        },
      }),
      // The trend is bucketed in memory (see `bucketRevenueByMonth` for why, and for the trigger to
      // push it into SQL) — so only two columns cross the wire.
      prismaClient.service.findMany({
        where: { ...LIVE, deliveryAt: inRange(trendFrom, thisMonth.to) },
        select: { deliveryAt: true, totalAmount: true },
      }),
      prismaClient.service.findMany({
        where: { ...LIVE, paidAt: null },
        select: { totalAmount: true, depositAmount: true },
      }),
      prismaClient.serviceDetail.groupBy({
        by: ["productId"],
        where: {
          isActive: true,
          service: { ...LIVE, deliveryAt: inRange(thisMonth.from, thisMonth.to) },
        },
        _sum: { quantity: true, parcialPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: TOP_PRODUCTS_LIMIT,
      }),
      prismaClient.service.groupBy({
        by: ["serviceStatusId"],
        where: { ...LIVE, readyAt: null },
        _count: { _all: true },
      }),
      // The reporting currency: whatever the newest live order was priced in. The business is
      // single-currency, so this is exact; if multi-currency ever lands, every total on this screen
      // has to become per-currency and THIS is the line that reveals it.
      prismaClient.service.findFirst({
        where: LIVE,
        orderBy: { id: "desc" },
        select: {
          currency: {
            select: { id: true, iso4217Code: true, name: true, symbol: true },
          },
        },
      }),
    ]);

    // A brand-new database has no orders at all — fall back to the seeded system currency rather
    // than inventing symbols, so an empty dashboard still formats its zeros correctly.
    const currency: DashboardCurrencyModel | null =
      latestCurrency?.currency ??
      (await prismaClient.currency.findFirst({
        orderBy: { id: "asc" },
        select: { id: true, iso4217Code: true, name: true, symbol: true },
      }));
    if (!currency) {
      logger.error(i18next.t("dashboard.getDashboard.logs.noCurrency"));
      sendOzariError(
        res,
        HttpEnum.INTERNAL_SERVER_ERROR,
        i18next.t("dashboard.getDashboard.unavailable"),
      );
      return;
    }

    const productNames = new Map(
      (
        await prismaClient.product.findMany({
          where: { id: { in: topProductRows.map((row) => row.productId) } },
          select: { id: true, name: true },
        })
      ).map((product) => [product.id, product.name]),
    );

    const upNext = selectUpNext(
      [...pendingDeliveries, ...pendingCollections],
      nextPendingEvent,
      UP_NEXT_LIMIT,
    ).map(({ row, event }) => projectUpNextItem(row, event, context, now));

    const revenueNow = round2(Number(currentMonth._sum.totalAmount ?? 0));
    const revenuePrev = round2(Number(previousMonth._sum.totalAmount ?? 0));
    const ordersNow = currentMonth._count._all;
    const ordersPrev = previousMonth._count._all;

    const topProducts: TopProductModel[] = topProductRows.map((row) => ({
      productId: row.productId,
      // A product deleted since the order shipped still has history; name it by id rather than
      // dropping the row, so the ranking's numbers keep adding up.
      name: productNames.get(row.productId) ?? `#${row.productId}`,
      quantity: row._sum.quantity ?? 0,
      revenue: round2(Number(row._sum.parcialPrice ?? 0)),
    }));

    const statusSplit: StatusSliceModel[] = statusRows
      .map((row) => {
        const status = statusById(context.catalog, row.serviceStatusId);
        return {
          statusId: row.serviceStatusId,
          name: status?.name ?? `#${row.serviceStatusId}`,
          ...(status?.colorKey && { colorKey: status.colorKey }),
          count: row._count._all,
        };
      })
      .sort((a, b) => b.count - a.count || a.statusId - b.statusId);

    const response: DashboardEnvelopeModel = {
      dashboard: {
        generatedAt: now,
        upNext,
        today: {
          deliveries: deliveriesToday,
          collections: collectionsToday,
          overdue: overdueDeliveries + overdueCollections,
          active: activeOrders,
        },
        month: {
          period: thisMonth,
          revenue: compare(revenueNow, revenuePrev),
          orders: compare(ordersNow, ordersPrev),
          averageOrder: compare(
            ordersNow === 0 ? 0 : round2(revenueNow / ordersNow),
            ordersPrev === 0 ? 0 : round2(revenuePrev / ordersPrev),
          ),
          cancelled: compare(cancelledThisMonth, cancelledLastMonth),
        },
        outstanding: outstandingFrom(unpaidRows),
        revenueTrend: bucketRevenueByMonth(trendRows, now, TREND_MONTHS),
        topProducts,
        statusSplit,
        currency,
      },
    };

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("dashboard.getDashboard.success"),
      response,
    );
  } catch (error) {
    logger.error(i18next.t("dashboard.getDashboard.logs.error"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("dashboard.getDashboard.unavailable"),
    );
  }
};
