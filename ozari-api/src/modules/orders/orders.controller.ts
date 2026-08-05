import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { decryptKms, encryptKms } from "@helpers/encryption.js";
import { encodeCoords } from "@helpers/geo.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { PaymentStatusEnum } from "@models/enums/paymentStatusEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { buildPaginationMeta } from "../products/products.service.js";
import {
  type CreateOrderRequestModel,
  type OrderAvailabilityRequestModel,
  type OrderAvailabilityResponseModel,
  type OrderCatalogResponseModel,
  type OrderDetailEnvelopeModel,
  type OrderListItemResponseModel,
  type OrderListResponseModel,
  type OrderStockConflictItemModel,
  type ProductAvailabilityModel,
} from "./orders.models.js";
import {
  evidenceBoundsFor,
  getEvidenceBounds,
  getStatusCatalog,
  holdingStatusIds,
  initialStatus,
} from "./lifecycle/lifecycle.service.js";
import { getStorage } from "@helpers/storage.js";
import {
  OrderDriverConflictError,
  OrderSelfOverlapError,
  assertDriverAvailable,
  findDriverConflicts,
  pendingLogisticsEvents,
  projectDriverAvailability,
  selfOverlap,
} from "./logistics/logistics.service.js";
import {
  ASSIGNABLE_ROLES,
  OrderNotFoundError,
  OrderStockConflictError,
  buildOrderListWhere,
  buildRentedInWindowWhere,
  computeBilledDays,
  holdsSaleStock,
  loadOrderProjectionContext,
  loadOrderTimingPreferences,
  orderListInclude,
  orderListOrderBy,
  parseOrderListQuery,
  priceOrderLine,
  projectOrderDetail,
  projectOrderListItem,
  releaseSaleStock,
  richOrderInclude,
  sortAgendaRows,
  type PricedOrderLineModel,
} from "./orders.service.js";

/**
 * The two LOGISTICS-PAD refusals, answered identically by create and edit — a `409` whose `data`
 * says WHICH rule refused and with what, so the form can put the message on the right date input
 * and quote the configured gap instead of hardcoding "1 hora".
 *
 * Deliberately its own payload key, never `data.conflicts`: that shape belongs to the STOCK
 * conflict and lands on a line's quantity. "We don't have the units" and "we can't be there" are
 * different problems with different fixes, and reusing one for the other is the single easiest way
 * to make both confusing (owner rule §2.4). Returns `true` when it answered the request.
 */
export const sendLogisticsConflict = (
  res: Response,
  scope: "createOrder" | "updateOrder" | "advance",
  error: unknown,
): boolean => {
  if (error instanceof OrderSelfOverlapError) {
    logger.warn(
      i18next.t(`orders.${scope}.logs.selfOverlap`, { gap: error.gapMinutes }),
    );
    sendOzariError(
      res,
      HttpEnum.CONFLICT,
      i18next.t(`orders.${scope}.selfOverlap`),
      undefined,
      { selfOverlap: { gapMinutes: error.gapMinutes } },
    );
    return true;
  }
  if (error instanceof OrderDriverConflictError) {
    logger.warn(
      i18next.t(`orders.${scope}.logs.driverConflict`, {
        orderId: error.conflict.orderId,
        conflictAt: error.conflict.at.toISOString(),
        driver: error.driverName ?? "",
      }),
    );
    sendOzariError(
      res,
      HttpEnum.CONFLICT,
      i18next.t(`orders.${scope}.driverConflict`),
      undefined,
      {
        driverConflict: {
          ...error.conflict,
          driverName: error.driverName,
          gapMinutes: error.gapMinutes,
        },
      },
    );
    return true;
  }
  return false;
};

/**
 * `GET /orders` — the paginated order list behind the agenda/history views. **Admin only** (route
 * guard; the Client "mis pedidos" and Driver "mis entregas" slices will widen this with their own
 * row scoping + role projection — see `projectOrderListItem`). The `view` decides both the rows
 * (agenda = still-work; history = finished/cancelled — `buildOrderListWhere` is the single split)
 * and the order (schedule vs log). Pagination, `view` and the `statusId` filter clamp or drop,
 * never 400 (the products-list stance).
 */
export const getOrders = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const query = parseOrderListQuery(req.query);
    // Role is DB-verified in verifyJwt; fall back to the least-privileged shape if somehow absent.
    const role = req.user?.userRole ?? RolesEnum.Client;
    const currentUserId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    // Row scoping: a Driver sees ONLY orders assigned to them; the Admin sees every order.
    const scopeUserId = role === RolesEnum.Driver ? currentUserId : undefined;
    const where = buildOrderListWhere(query, scopeUserId);
    // The lifecycle machine, loaded once for the whole page (the catalog is memoized in-process).
    const context = await loadOrderProjectionContext({
      userId: currentUserId,
      role,
    });

    // AGENDA: the active set is small (single-vehicle logistics), so fetch every matching row and
    // order it in memory — MINE first, then soonest NEXT ACTION (delivery/pickup/"listo") — then
    // slice the page. HISTORY is a growing log, so it keeps native pagination (newest delivery
    // first) with no owner grouping.
    let orders: OrderListItemResponseModel[];
    let total: number;
    if (query.view === "agenda") {
      const rows = await prismaClient.service.findMany({
        where,
        include: orderListInclude,
      });
      const sorted = sortAgendaRows(rows, currentUserId);
      total = sorted.length;
      const start = (query.page - 1) * query.pageSize;
      orders = sorted
        .slice(start, start + query.pageSize)
        .map((row) => projectOrderListItem(row, context));
    } else {
      const [rows, count] = await Promise.all([
        prismaClient.service.findMany({
          where,
          include: orderListInclude,
          orderBy: orderListOrderBy(query.view),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prismaClient.service.count({ where }),
      ]);
      orders = rows.map((row) => projectOrderListItem(row, context));
      total = count;
    }

    const response: OrderListResponseModel = {
      orders,
      pagination: buildPaginationMeta(query.page, query.pageSize, total),
    };

    logger.info(
      i18next.t("orders.getOrders.logs.ordersFetched", { count: total }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("orders.getOrders.ordersFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("orders.getOrders.logs.errorFetchingOrders", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.getOrders.errorFetchingOrders"),
    );
  }
};

/**
 * `GET /orders/:id` — one order, the full detail shape (decrypted snapshots, money breakdown,
 * lines/extras, status audit trail). A malformed id and an unknown id are both a plain **404** —
 * the lookup either finds the row or it doesn't (the products-detail stance). Orders are never
 * deleted (no-trash) but `isActive` is honoured defensively, like the list.
 */
export const getOrderById = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    const validId = Number.isInteger(id) && id >= 1;
    const role = req.user?.userRole ?? RolesEnum.Client;
    const currentUserId = req.user?.userId ?? 0;

    const prismaClient = await getPrismaClient();
    const rawOrder = validId
      ? await prismaClient.service.findFirst({
          // Row scoping, same rule as the list: a Driver may open ONLY an order assigned to them —
          // typing another order's id in the URL (or calling this directly) finds nothing and gets
          // the same plain 404 as a non-existent order. It deliberately does NOT answer 403: that
          // would confirm the order exists to someone who may not know it does.
          where: {
            id,
            isActive: true,
            ...(role === RolesEnum.Driver ? { assignedUserId: currentUserId } : {}),
          },
          include: richOrderInclude,
        })
      : null;

    if (!rawOrder) {
      logger.warn(
        i18next.t("orders.getOrderById.logs.orderNotFound", {
          id: req.params["id"],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("orders.getOrderById.orderNotFound"),
      );
      return;
    }

    const response: OrderDetailEnvelopeModel = {
      order: projectOrderDetail(
        rawOrder,
        await loadOrderProjectionContext({ userId: currentUserId, role }),
      ),
    };
    logger.info(i18next.t("orders.getOrderById.logs.orderFetched", { id }));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("orders.getOrderById.orderFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("orders.getOrderById.logs.errorFetchingOrder", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.getOrderById.errorFetchingOrder"),
    );
  }
};

/**
 * `POST /orders` — the admin creates an order on behalf of a WALK-IN client (the WhatsApp/phone
 * flow; identity = a client registry — see the request model for the platform-user door). The
 * validator guaranteed a well-formed request; everything RACY happens here, INSIDE one
 * `$transaction`:
 *
 *  1. The line products are locked (`SELECT … FOR UPDATE`) so two concurrent creates serialize
 *     per product — the availability read below can't be stale by commit time.
 *  2. Rental availability is derived against the ORDER's window (`buildRentedInWindowWhere` — the
 *     EPIC-1 §5 obligation) and sale lines against remaining stock; ANY shortfall rolls back and
 *     surfaces as a structured **409** listing exactly which lines lack stock and the counts
 *     (EPIC-2 §8 — the form re-offers).
 *  3. The 1h-spacing rule (an admin PREFERENCE, read from `app_preferences`) is checked against
 *     every active order's delivery/pickup — the admin is blocked exactly like a client. Also a
 *     **409**. (Inserts aren't phantom-proof here — two admins confirming within the same second
 *     could slip past each other — accepted: a single-admin business; the products lock already
 *     serializes the dangerous stock race.)
 *  4. Sale stock is decremented, and the order is created in PENDING (confirmed — stock freezes at
 *     confirmation, no reservation step) with its money derived SERVER-SIDE from the product rows
 *     (`priceOrderLine`; a client-sent price never exists), the encrypted delivery snapshots, and
 *     the first `service_status_history` row (creation, by this admin).
 *
 * The response is the same `{ order }` detail envelope as `GET /orders/:id`, so the agenda cache
 * can absorb it without translation.
 */
export const createOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as CreateOrderRequestModel;
    /* v8 ignore next -- the route guarantees an authenticated admin; the fallback is defensive */
    const byUserId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();

    // The lifecycle machine decides where a new order STARTS and which statuses hold units — both
    // read from the `service_status` flags, never from a literal id.
    const catalog = await getStatusCatalog();
    const initial = initialStatus(catalog);
    const holding = holdingStatusIds(catalog);
    if (!initial) {
      // No active initial step: the lifecycle was misconfigured (or never seeded). Refusing beats
      // inventing a status — the admin fixes it in "Estados del pedido" (or re-seeds).
      logger.error(i18next.t("orders.createOrder.logs.lifecycleUnconfigured"));
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("orders.createOrder.lifecycleUnconfigured"),
      );
      return;
    }

    // One linear transaction script (lock → price → availability → spacing → write); splitting
    // the steps would scatter the atomicity story across helpers that can never run outside it.
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity
    const created = await prismaClient.$transaction(async (tx) => {
      const productIds = body.lines.map((line) => line.productId);
      // Serialize concurrent creates touching the same products (see the doc above).
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;

      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: {
          id: true,
          name: true,
          quantity: true,
          currencyId: true,
          productBusinessTypeId: true,
          rentTimeUnitId: true,
          rentPrice: true,
          sellPrice: true,
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));

      // Price every line from its product row. `pickupAt` exists whenever a rental line does (the
      // validator's mode-coherence rule), so billed days always have a window to derive from.
      const billedDays = body.pickupAt ? computeBilledDays(body.deliveryAt, body.pickupAt) : 1;
      const pricedLines: PricedOrderLineModel[] = [];
      for (const line of body.lines) {
        const product = productById.get(line.productId);
        const priced = product ? priceOrderLine(line.quantity, product, billedDays) : null;
        // A product deleted between validation and the lock = a conflict, not a server fault.
        if (!priced) {
          throw new OrderStockConflictError([
            {
              productId: line.productId,
              productName: product?.name ?? `#${line.productId}`,
              requested: line.quantity,
              available: 0,
            },
          ]);
        }
        pricedLines.push(priced);
      }

      // The two clock rules, read once under the lock: how far apart logistics events must be, and
      // how long returned goods are being washed (which is part of how long they stay unavailable).
      const timing = await loadOrderTimingPreferences(tx);

      // Availability, under the lock: rentals against the window, sales against remaining stock.
      const rentalIds = pricedLines.filter((line) => line.isRental).map((line) => line.productId);
      const rentedRows =
        rentalIds.length > 0 && body.pickupAt
          ? await tx.serviceDetail.groupBy({
              by: ["productId"],
              where: buildRentedInWindowWhere(
                rentalIds,
                body.deliveryAt,
                body.pickupAt,
                holding,
                { turnaroundMinutes: timing.turnaroundMinutes },
              ),
              _sum: { quantity: true },
            })
          : [];
      const rentedByProduct = new Map(rentedRows.map((row) => [row.productId, row._sum.quantity ?? 0]));
      const conflicts: OrderStockConflictItemModel[] = [];
      for (const line of pricedLines) {
        const product = productById.get(line.productId);
        /* v8 ignore next 3 -- every priced line's product is in the map; the guard is defensive */
        if (!product) {
          continue;
        }
        const available = line.isRental
          ? Math.max(0, product.quantity - (rentedByProduct.get(line.productId) ?? 0))
          : product.quantity;
        if (available < line.quantity) {
          conflicts.push({
            productId: product.id,
            productName: product.name,
            requested: line.quantity,
            available,
          });
        }
      }
      if (conflicts.length > 0) {
        throw new OrderStockConflictError(conflicts);
      }

      // The logistics pad: each event occupies a block of its DRIVER's day, and two blocks on the
      // same driver may not overlap — including this order's OWN delivery and collection, which
      // nothing checked before (§3.1). The gap is an admin preference, never hardcoded. A brand-new
      // order has performed nothing, so every event it declares is pending.
      await assertDriverAvailable(tx, pendingLogisticsEvents(body), {
        gapMinutes: timing.spacingMinutes,
        driverId: body.assignedUserId,
      });

      // Sales consume stock permanently at confirmation (a sold unit never comes back).
      await Promise.all(
        pricedLines
          .filter((line) => !line.isRental)
          .map((line) =>
            tx.product.update({
              where: { id: line.productId },
              data: { quantity: { decrement: line.quantity } },
            }),
          ),
      );

      const linesTotal = pricedLines.reduce((sum, line) => sum + line.parcialPrice, 0);
      const totalAmount = Math.round((linesTotal + (body.deliveryAmount ?? 0)) * 100) / 100;
      /* v8 ignore next -- the validator rejects mixed/empty currencies; the fallback is defensive */
      const currencyId = products[0]?.currencyId ?? 1;

      const order = await tx.service.create({
        data: {
          clientRegistryId: body.clientRegistryId,
          eventTypeId: body.eventTypeId,
          deliveryNameKms: encryptKms(body.deliveryName),
          deliveryContactKms: encryptKms(body.deliveryContact),
          deliveryAddressKms: encryptKms(body.deliveryAddress),
          // The pin travels with the text it belongs to — snapshotted, encrypted, and NULL when the
          // admin never placed one (the overwhelmingly common case).
          deliveryCoordsKms:
            body.deliveryCoords !== undefined ? encryptKms(encodeCoords(body.deliveryCoords)) : null,
          deliveryInstructionsKms:
            body.deliveryInstructions !== undefined
              ? encryptKms(body.deliveryInstructions)
              : null,
          description: body.description ?? null,
          comment: body.comment ?? null,
          deliveryAt: body.deliveryAt,
          pickupAt: body.pickupAt ?? null,
          // The BILLED period: the delivery→pickup window; a purchase-only order bills once on
          // its delivery day.
          serviceStart: body.deliveryAt,
          serviceEnd: body.pickupAt ?? body.deliveryAt,
          totalAmount,
          deliveryAmount: body.deliveryAmount ?? null,
          depositAmount: body.depositAmount ?? null,
          // `paymentMethodId` is deliberately NOT set here: it records how the order was actually
          // paid, which has not happened yet. It stays NULL until `POST /orders/:id/payment`.
          // Assignment: the chosen deliverable staff, REQUIRED by the validator (Q-D2) — every
          // event needs an owner, because the logistics pad is a rule about a driver's day. The
          // admin's own orders read as `isMine` on the agenda (Mis pedidos + the quick action).
          assignedUserId: body.assignedUserId,
          currencyId,
          // The configured entry point of the pipeline (today "Pendiente" — the `isInitial` row).
          serviceStatusId: initial.id,
          paymentStatusId: PaymentStatusEnum.PENDING,
          serviceDetails: {
            create: pricedLines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              isRental: line.isRental,
              unitaryPrice: line.unitaryPrice,
              parcialPrice: line.parcialPrice,
              currencyId,
            })),
          },
          // The audit trail's creation row: no previous status, confirmed by this admin.
          statusHistory: {
            create: { toStatusId: initial.id, byUserId },
          },
        },
        select: { id: true },
      });

      return tx.service.findUniqueOrThrow({
        where: { id: order.id },
        include: richOrderInclude,
      });
    });

    logger.info(i18next.t("orders.createOrder.logs.orderCreated", { id: created.id }));
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Order ID ${created.id}`,
        success: true,
        metadata: { operation: "ORDER_CREATED" },
      });
    }

    const response: OrderDetailEnvelopeModel = {
      order: projectOrderDetail(
        created,
        await loadOrderProjectionContext({
          userId: byUserId,
          role: req.user?.userRole ?? RolesEnum.Admin,
        }),
      ),
    };
    sendOzariSuccess(
      res,
      HttpEnum.CREATED,
      i18next.t("orders.createOrder.orderCreated"),
      response,
    );
  } catch (error) {
    if (error instanceof OrderStockConflictError) {
      logger.warn(
        i18next.t("orders.createOrder.logs.stockConflict", {
          conflicts: JSON.stringify(error.conflicts),
        }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("orders.createOrder.stockConflict"),
        undefined,
        { conflicts: error.conflicts },
      );
      return;
    }
    if (sendLogisticsConflict(res, "createOrder", error)) {
      return;
    }
    logger.error(i18next.t("orders.createOrder.logs.errorCreatingOrder", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.createOrder.errorCreatingOrder"),
    );
  }
};

/**
 * `PUT /orders/:id` — **the full order edit. Admin only.**
 *
 * DECLARATIVE, like the products update (the RECONCILE design): the client stages every change and
 * sends the FINAL state of the order — identity, snapshots, logistics window, assignment, money and
 * the complete line list. The server diffs it in ONE transaction. There is deliberately no
 * per-field or per-line endpoint; a partial edit could leave the window and the lines describing
 * different orders, and every rule here (pricing, availability, spacing) reads BOTH.
 *
 * **Everything is re-derived, nothing is trusted.** Prices come from the product rows and the billed
 * window, exactly as at creation — so moving the dates re-bills the order and a client-sent price is
 * ignored. Sale lines' `products.quantity` moves by the DIFFERENCE, and only while the order still
 * holds them (`holdsSaleStock`): once delivered, the goods are with the client and correcting the
 * paperwork must not restock anything.
 *
 * **Availability is re-checked exactly when the order actually reserves something** — the same
 * `inventoryHold` derivation as everywhere else, so an order sitting on a NONE step (finished) or a
 * cancelled one is a pure paperwork edit that reserves nothing and can never 409. When it does hold,
 * the check EXCLUDES this order from the count: it is holding its own current lines, and would
 * otherwise conflict with itself. The spacing rule excludes it for the same reason.
 *
 * The lifecycle is untouched: an edit never moves the status, never stamps an actual and never
 * writes history. Where the order stands is `POST /orders/:id/advance`'s business, and only its.
 *
 * **PAYMENT is untouched for the same reason** — `paymentMethodId`, `paidAt` and `paymentStatusId`
 * are never written here. This endpoint rewrites what was AGREED; what HAPPENED (a move, a payment)
 * belongs to its own door, `POST /orders/:id/payment`. Without that boundary a declarative
 * full-state save would erase a recorded payment every time somebody corrected an address.
 */
export const updateOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as CreateOrderRequestModel;
    const id = Number(req.params["id"]);
    /* v8 ignore next -- the route guarantees an authenticated admin; the fallback is defensive */
    const byUserId = req.user?.userId ?? 0;
    if (!Number.isInteger(id) || id < 1) {
      throw new OrderNotFoundError();
    }

    const catalog = await getStatusCatalog();
    const holding = holdingStatusIds(catalog);
    const prismaClient = await getPrismaClient();

    // The same linear transaction script as create (lock → price → availability → spacing → stock
    // delta → reconcile); splitting it would scatter an atomicity story that can never run outside
    // the transaction.
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity
    const updated = await prismaClient.$transaction(async (tx) => {
      // Serialize against concurrent advances of THIS order and concurrent creates touching the
      // SAME products — including the ones being dropped, whose stock we may have to give back.
      await tx.$queryRaw`SELECT id FROM services WHERE id = ${id} FOR UPDATE`;
      const order = await tx.service.findFirst({
        where: { id, isActive: true },
        include: richOrderInclude,
      });
      if (!order) {
        throw new OrderNotFoundError();
      }

      const productIds = [
        ...new Set([
          ...body.lines.map((line) => line.productId),
          ...order.serviceDetails.map((line) => line.productId),
        ]),
      ];
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: {
          id: true,
          name: true,
          quantity: true,
          currencyId: true,
          productBusinessTypeId: true,
          rentTimeUnitId: true,
          rentPrice: true,
          sellPrice: true,
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));

      // Re-price from the NEW window: the same engine as create, so an edit that moves the dates
      // re-bills the rental days rather than carrying the old amounts forward.
      const billedDays = body.pickupAt ? computeBilledDays(body.deliveryAt, body.pickupAt) : 1;
      const pricedLines: PricedOrderLineModel[] = [];
      for (const line of body.lines) {
        const product = productById.get(line.productId);
        const priced = product ? priceOrderLine(line.quantity, product, billedDays) : null;
        if (!priced) {
          throw new OrderStockConflictError([
            {
              productId: line.productId,
              productName: product?.name ?? `#${line.productId}`,
              requested: line.quantity,
              available: 0,
            },
          ]);
        }
        pricedLines.push(priced);
      }

      // What the order reserves TODAY decides what has to be re-checked. Both flags are derived —
      // an order on a NONE step (finished) or a cancelled one holds nothing, so its edit is pure
      // paperwork and can never fail on availability.
      const holdsRental =
        order.cancelledAt === null &&
        holding.out.concat(holding.window).includes(order.serviceStatusId);
      const holdsSale = holdsSaleStock(order);
      // What THIS order currently has of each product, per inventory — the pool an edit gets back.
      const currentByProduct = new Map(
        order.serviceDetails.map((line) => [line.productId, line]),
      );

      const timing = await loadOrderTimingPreferences(tx);
      const conflicts: OrderStockConflictItemModel[] = [];
      const rentalIds = pricedLines.filter((line) => line.isRental).map((line) => line.productId);
      const rentedRows =
        holdsRental && rentalIds.length > 0 && body.pickupAt
          ? await tx.serviceDetail.groupBy({
              by: ["productId"],
              where: buildRentedInWindowWhere(rentalIds, body.deliveryAt, body.pickupAt, holding, {
                turnaroundMinutes: timing.turnaroundMinutes,
                // Excluding itself: the order is holding its own current lines, and an order can
                // never be unavailable because of itself.
                excludeServiceId: id,
              }),
              _sum: { quantity: true },
            })
          : [];
      const rentedByProduct = new Map(rentedRows.map((row) => [row.productId, row._sum.quantity ?? 0]));
      for (const line of pricedLines) {
        const product = productById.get(line.productId);
        /* v8 ignore next 3 -- every priced line's product is in the map; the guard is defensive */
        if (!product) {
          continue;
        }
        if (line.isRental) {
          if (!holdsRental) {
            continue; // the order reserves no rental units — nothing to compete for
          }
          const available = Math.max(
            0,
            product.quantity - (rentedByProduct.get(line.productId) ?? 0),
          );
          if (available < line.quantity) {
            conflicts.push({
              productId: product.id,
              productName: product.name,
              requested: line.quantity,
              available,
            });
          }
          continue;
        }
        if (!holdsSale) {
          // Symmetric with the rental branch: the order reserves no sale units (it was cancelled,
          // or the goods were delivered and are with the client), so the edit moves no stock at all
          // — nothing can be short, and refusing the paperwork would fix nothing.
          continue;
        }
        // Sale: the shelf ALREADY has this order's decrement applied, so what it may take is the
        // remaining stock PLUS whatever it is currently holding of that product.
        const currentLine = currentByProduct.get(line.productId);
        const heldHere =
          currentLine !== undefined && !currentLine.isRental ? currentLine.quantity : 0;
        const available = product.quantity + heldHere;
        if (available < line.quantity) {
          conflicts.push({
            productId: product.id,
            productName: product.name,
            requested: line.quantity,
            available,
          });
        }
      }
      if (conflicts.length > 0) {
        throw new OrderStockConflictError(conflicts);
      }

      // The logistics pad — the order as it STANDS (its actuals, its cancellation) with the NEW
      // dates, minus itself: it already occupies its driver at exactly its own moments. Only the
      // events still to be PERFORMED are checked, so a cancelled or delivered one asks the driver's
      // day for nothing, exactly like the stock rules above; a half-finished rental is still
      // checked on its collection. The assignee is the NEW one — an edit that hands the order to
      // another driver is a question about THAT driver's day.
      await assertDriverAvailable(
        tx,
        pendingLogisticsEvents({ ...order, deliveryAt: body.deliveryAt, pickupAt: body.pickupAt }),
        { gapMinutes: timing.spacingMinutes, driverId: body.assignedUserId, excludeServiceId: id },
      );

      // Sale stock moves by the DIFFERENCE, and only while the order still holds it. A product that
      // left the order gives its whole quantity back; a new one takes its whole quantity.
      if (holdsSale) {
        const deltas = new Map<number, number>();
        for (const line of order.serviceDetails.filter((detail) => !detail.isRental)) {
          deltas.set(line.productId, (deltas.get(line.productId) ?? 0) + line.quantity);
        }
        for (const line of pricedLines.filter((detail) => !detail.isRental)) {
          deltas.set(line.productId, (deltas.get(line.productId) ?? 0) - line.quantity);
        }
        await Promise.all(
          [...deltas.entries()]
            .filter(([, delta]) => delta !== 0)
            .map(([productId, delta]) =>
              tx.product.update({
                where: { id: productId },
                data: { quantity: { increment: delta } },
              }),
            ),
        );
      }

      const linesTotal = pricedLines.reduce((sum, line) => sum + line.parcialPrice, 0);
      const totalAmount = Math.round((linesTotal + (body.deliveryAmount ?? 0)) * 100) / 100;
      /* v8 ignore next -- the validator rejects mixed/empty currencies; the fallback is defensive */
      const currencyId = productById.get(pricedLines[0]?.productId ?? 0)?.currencyId ?? order.currencyId;

      // Lines are reconciled BY PRODUCT: a line whose product survives keeps its row (and its id),
      // one whose product left is deleted, a new product creates a row. `service_details` are part
      // of the order's current state, not of its audit trail — the trail is `service_status_history`
      // — so a dropped line hard-deletes, per the NO-TRASH policy.
      const keptIds = new Set(pricedLines.map((line) => line.productId));
      const removed = order.serviceDetails.filter((line) => !keptIds.has(line.productId));
      if (removed.length > 0) {
        await tx.serviceDetail.deleteMany({
          where: { id: { in: removed.map((line) => line.id) } },
        });
      }
      await Promise.all(
        pricedLines.map((line) => {
          const existing = currentByProduct.get(line.productId);
          const data = {
            quantity: line.quantity,
            isRental: line.isRental,
            unitaryPrice: line.unitaryPrice,
            parcialPrice: line.parcialPrice,
            currencyId,
          };
          return existing
            ? tx.serviceDetail.update({ where: { id: existing.id }, data })
            : tx.serviceDetail.create({
                data: { ...data, serviceId: id, productId: line.productId },
              });
        }),
      );

      await tx.service.update({
        where: { id },
        data: {
          clientRegistryId: body.clientRegistryId,
          eventTypeId: body.eventTypeId,
          deliveryNameKms: encryptKms(body.deliveryName),
          deliveryContactKms: encryptKms(body.deliveryContact),
          deliveryAddressKms: encryptKms(body.deliveryAddress),
          // The pin travels with the text it belongs to — snapshotted, encrypted, and NULL when the
          // admin never placed one (the overwhelmingly common case).
          deliveryCoordsKms:
            body.deliveryCoords !== undefined ? encryptKms(encodeCoords(body.deliveryCoords)) : null,
          deliveryInstructionsKms:
            body.deliveryInstructions !== undefined
              ? encryptKms(body.deliveryInstructions)
              : null,
          description: body.description ?? null,
          comment: body.comment ?? null,
          deliveryAt: body.deliveryAt,
          pickupAt: body.pickupAt ?? null,
          serviceStart: body.deliveryAt,
          serviceEnd: body.pickupAt ?? body.deliveryAt,
          totalAmount,
          deliveryAmount: body.deliveryAmount ?? null,
          depositAmount: body.depositAmount ?? null,
          // NOTE: no `paymentMethodId`/`paidAt`/`paymentStatusId` — an edit never touches PAYMENT,
          // the same boundary it has with the lifecycle (see this function's doc comment).
          // REQUIRED (Q-D2), and the edit form always sends the order's CURRENT assignee back — so
          // saving an untouched form is not a silent reassignment, while deliberately changing the
          // picker moves the order (and re-checks the new driver's day above).
          assignedUserId: body.assignedUserId,
          currencyId,
        },
      });

      return tx.service.findUniqueOrThrow({ where: { id }, include: richOrderInclude });
    });

    logger.info(i18next.t("orders.updateOrder.logs.orderUpdated", { id }));
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Order ID ${id}`,
        success: true,
        metadata: { operation: "ORDER_UPDATED" },
      });
    }

    const response: OrderDetailEnvelopeModel = {
      order: projectOrderDetail(
        updated,
        await loadOrderProjectionContext({
          userId: byUserId,
          role: req.user?.userRole ?? RolesEnum.Admin,
        }),
      ),
    };
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("orders.updateOrder.orderUpdated"), response);
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      logger.warn(i18next.t("orders.updateOrder.logs.orderNotFound", { id: req.params["id"] }));
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.updateOrder.orderNotFound"));
      return;
    }
    if (error instanceof OrderStockConflictError) {
      logger.warn(
        i18next.t("orders.updateOrder.logs.stockConflict", {
          conflicts: JSON.stringify(error.conflicts),
        }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("orders.updateOrder.stockConflict"),
        undefined,
        { conflicts: error.conflicts },
      );
      return;
    }
    if (sendLogisticsConflict(res, "updateOrder", error)) {
      return;
    }
    logger.error(i18next.t("orders.updateOrder.logs.errorUpdatingOrder", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.updateOrder.errorUpdatingOrder"),
    );
  }
};

/**
 * `DELETE /orders/:id` — **permanently destroys an order. Admin only.**
 *
 * This is the deliberate exception to the no-tombstone rule going the OTHER way (owner decision,
 * 2026-07-28): a cancelled order is history worth keeping, but an order deleted on purpose is one
 * the admin has decided never should have existed — so nothing of it is kept. In ONE transaction it
 * cascades through everything that only exists because of this order (evidence rows, the status
 * trail, lines, extras) and then the order itself; the evidence's R2 objects are deleted after the
 * commit, best-effort (a failure leaves a sweepable orphan, never a row pointing at a dead file).
 *
 * **Sale stock is restored.** Sale lines decrement `products.quantity` at creation; an order that
 * never happened must give those units back. Rental holds need nothing — they are derived from the
 * status, so they vanish with the row.
 *
 * There is no undo, which is why the UI states that plainly before asking.
 */
export const deleteOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id < 1) {
      logger.warn(i18next.t("orders.deleteOrder.logs.orderNotFound", { id: req.params["id"] }));
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.deleteOrder.orderNotFound"));
      return;
    }

    const prismaClient = await getPrismaClient();
    const purgedKeys = await prismaClient.$transaction(async (tx) => {
      const order = await tx.service.findUnique({
        where: { id },
        select: {
          id: true,
          cancelledAt: true,
          deliveredAt: true,
          serviceDetails: { select: { productId: true, quantity: true, isRental: true } },
          evidences: { select: { r2Key: true } },
        },
      });
      if (!order) {
        throw new OrderNotFoundError();
      }

      // Give back what the sale lines took at creation — but ONLY if this order is still HOLDING
      // them. A cancelled order already handed them back; a delivered one handed the goods to the
      // client, and deleting the paperwork can't bring those home. Restoring in either case would
      // invent stock. (Rentals never took a number: their hold is derived from the status and
      // disappears with the row, whatever state it was in.)
      if (holdsSaleStock(order)) {
        await releaseSaleStock(tx, order.serviceDetails);
      }

      // Children first — every one of these rows exists only because this order did.
      await tx.serviceEvidence.deleteMany({ where: { serviceId: id } });
      await tx.serviceStatusHistory.deleteMany({ where: { serviceId: id } });
      await tx.serviceDetail.deleteMany({ where: { serviceId: id } });
      await tx.serviceExtra.deleteMany({ where: { serviceId: id } });
      await tx.service.delete({ where: { id } });
      return order.evidences.map((photo) => photo.r2Key);
    });

    if (purgedKeys.length > 0) {
      try {
        await getStorage().deleteObjects(purgedKeys);
      } catch (error) {
        logger.warn(i18next.t("orders.deleteOrder.logs.evidenceCleanupFailed", { error }));
      }
    }

    logger.info(i18next.t("orders.deleteOrder.logs.orderDeleted", { id }));
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Order ID ${id}`,
        success: true,
        metadata: { operation: "ORDER_DELETED", evidenceObjects: purgedKeys.length },
      });
    }
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("orders.deleteOrder.orderDeleted"));
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      logger.warn(i18next.t("orders.deleteOrder.logs.orderNotFound", { id: req.params["id"] }));
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.deleteOrder.orderNotFound"));
      return;
    }
    logger.error(i18next.t("orders.deleteOrder.logs.errorDeletingOrder", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.deleteOrder.errorDeletingOrder"),
    );
  }
};

/**
 * `GET /orders/catalog` — the seeded reference lists the orders section consumes: event types
 * (with their client lead-times), the status vocabularies for filters/chips, and the contact
 * types + zones the client-registry form needs. Active rows, id order, id + name only (plus
 * `minLeadHours` on event types). **Admin only**, like every orders read today.
 */
/** The numeric zone from a "Zona N" name, for sorting the picker 1 → 25 (the seeded ids are not in
 *  zone order). Non-numeric names sort first (0). */
const zoneNumber = (name: string): number => Number.parseInt(name.replace(/\D/g, ""), 10) || 0;

export const getOrdersCatalog = async (
  _req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const option = {
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    } as const;
    const [
      eventTypes,
      statusCatalog,
      evidenceBounds,
      paymentStatuses,
      paymentMethods,
      contactTypes,
      zoneRows,
      assignableRows,
    ] = await Promise.all([
      prismaClient.eventType.findMany({
        ...option,
        select: { id: true, name: true, minLeadHours: true },
      }),
      // The lifecycle statuses come from the ENGINE's cached catalog (with their flags), not a raw
      // lookup query — one vocabulary, one source.
      getStatusCatalog(),
      getEvidenceBounds(),
      prismaClient.paymentStatus.findMany(option),
      prismaClient.paymentMethod.findMany(option),
      prismaClient.contactType.findMany(option),
      prismaClient.zone.findMany({
        ...option,
        select: { id: true, name: true, deliveryFee: true },
      }),
      // The staff an order can be assigned to — active "deliverable" roles (Admin + Driver today).
      // Names are decrypted; the role name rides along for the picker. Sorted below (encrypted at
      // rest, so a DB `orderBy` on the name is impossible).
      prismaClient.user.findMany({
        where: { isActive: true, roleId: { in: [...ASSIGNABLE_ROLES] } },
        select: { id: true, fullNameKms: true, role: { select: { name: true } } },
      }),
    ]);

    const response: OrderCatalogResponseModel = {
      eventTypes,
      // Published (active) statuses in PIPELINE order, the disruptive off-ramps last — the order a
      // filter row or a lifecycle diagram should read in. Evidence counts arrive resolved.
      serviceStatuses: statusCatalog
        .filter((status) => status.isActive)
        .sort(
          (a, b) =>
            (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
        )
        .map((status) => {
          const bounds = evidenceBoundsFor(status, evidenceBounds);
          return {
            id: status.id,
            name: status.name,
            sortOrder: status.sortOrder ?? undefined,
            isInitial: status.isInitial,
            isDisruptive: status.isDisruptive,
            inventoryHold: status.inventoryHold,
            requiresEvidence: status.requiresEvidence,
            minEvidence: bounds.min,
            maxEvidence: bounds.max,
            appliesTo: status.appliesTo,
            tracksEvent: status.tracksEvent ?? undefined,
            colorKey: status.colorKey ?? undefined,
          };
        }),
      paymentStatuses,
      paymentMethods,
      contactTypes,
      // Ordered by the ZONE NUMBER (Zona 1 → 25), not by id (the seeded ids don't run in zone order).
      // Decimal → number, dropping NULL (not configured) so the form only autofills a real fee.
      zones: zoneRows
        .slice()
        .sort((a, b) => zoneNumber(a.name) - zoneNumber(b.name))
        .map((zone) => ({
          id: zone.id,
          name: zone.name,
          ...(zone.deliveryFee !== null && { deliveryFee: Number(zone.deliveryFee) }),
        })),
      assignableUsers: assignableRows
        .map((user) => ({ id: user.id, name: decryptKms(user.fullNameKms), role: user.role.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    };

    logger.info(i18next.t("orders.catalog.logs.catalogFetched"));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("orders.catalog.catalogFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("orders.catalog.logs.errorFetchingCatalog", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.catalog.errorFetchingCatalog"),
    );
  }
};

/**
 * `POST /orders/availability` — the admin's live per-window probe, answering the order form's TWO
 * scheduling questions on one keystroke (EPIC-2 §10.C + EPIC-2-DRIVER-AVAILABILITY §4.3):
 *
 * - **Do we have the goods?** Per product, the takeable amount for the window, so the picker can
 *   annotate amounts and reconcile picked lines. Rentals are fleet minus what's held in the window
 *   (only computable once a pickup exists → `null` otherwise); sales are current stock. Exact
 *   counts — the ADMIN runs the business (§11.A); a Client tier would cap instead.
 * - **Can the driver be there?** Only when an `assignedUserId` is sent: whether either of the
 *   order's events would overlap a block already on that driver's day, plus whether the order's own
 *   delivery and collection are too close to each other. Shaped by `projectDriverAvailability`, so
 *   a future client tier is a branch there rather than a new endpoint that leaks a name or a count.
 *
 * `excludeOrderId` (an EDIT re-checking itself) drops that order from BOTH counts — it holds its
 * own rental units and occupies its driver at exactly its own two moments, and an order can never
 * be unavailable because of itself. Its actuals also decide which of its events still occupy a day
 * at all, so a finished or cancelled order probes as free, exactly as the save treats it.
 *
 * A pure read (no lock) and ADVISORY in both halves: create/edit re-derive everything under the
 * product locks inside their transaction, and that `409` stays the authority. The probe exists so
 * the admin does not fill in a form that cannot be saved.
 */
export const getOrderAvailability = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as OrderAvailabilityRequestModel;
    const prismaClient = await getPrismaClient();
    const holding = holdingStatusIds(await getStatusCatalog());
    const products = await prismaClient.product.findMany({
      where: { id: { in: body.productIds }, isActive: true },
      select: { id: true, quantity: true, productBusinessTypeId: true },
    });
    const rentalIds = products
      .filter((product) => product.productBusinessTypeId === BusinessTypeEnum.RENT)
      .map((product) => product.id);
    // The probe must answer with the SAME rules the create will enforce — washing period and
    // logistics gap included — or the form would offer what the save then refuses.
    const { turnaroundMinutes, spacingMinutes } =
      await loadOrderTimingPreferences(prismaClient);
    // The order being EDITED, when there is one: its actuals decide which of its events still
    // occupy a driver, and its id drops it from both counts. Without this the probe would answer a
    // stricter question than the save — an edit competing with its own held units and its own two
    // blocks — and the form would cap lines the server was about to accept.
    const editing =
      body.excludeOrderId !== undefined
        ? await prismaClient.service.findUnique({
            where: { id: body.excludeOrderId },
            select: { deliveredAt: true, collectedAt: true, cancelledAt: true },
          })
        : null;
    const rentedRows =
      rentalIds.length > 0 && body.pickupAt
        ? await prismaClient.serviceDetail.groupBy({
            by: ["productId"],
            where: buildRentedInWindowWhere(
              rentalIds,
              body.deliveryAt,
              body.pickupAt,
              holding,
              {
                turnaroundMinutes,
                ...(body.excludeOrderId !== undefined && {
                  excludeServiceId: body.excludeOrderId,
                }),
              },
            ),
            _sum: { quantity: true },
          })
        : [];
    const rentedByProduct = new Map(rentedRows.map((row) => [row.productId, row._sum.quantity ?? 0]));

    const availability: ProductAvailabilityModel[] = products.map((product) => {
      const isRental = product.productBusinessTypeId === BusinessTypeEnum.RENT;
      let available: number | null;
      if (!isRental) {
        available = product.quantity;
      } else if (body.pickupAt) {
        available = Math.max(0, product.quantity - (rentedByProduct.get(product.id) ?? 0));
      } else {
        available = null;
      }
      return { productId: product.id, available };
    });

    // The DRIVER half — only when the form has reached the assignee. Same two-step rule as the
    // save: SQL widens by the maximum pad, `refineConflicts` decides.
    let driver: OrderAvailabilityResponseModel["driver"];
    if (body.assignedUserId !== undefined) {
      const events = pendingLogisticsEvents({
        deliveryAt: body.deliveryAt,
        pickupAt: body.pickupAt,
        ...(editing ?? {}),
      });
      const { conflicts, driverName } = await findDriverConflicts(
        prismaClient,
        events,
        {
          gapMinutes: spacingMinutes,
          driverId: body.assignedUserId,
          ...(body.excludeOrderId !== undefined && {
            excludeServiceId: body.excludeOrderId,
          }),
        },
      );
      driver = projectDriverAvailability(
        { role: req.user?.userRole ?? RolesEnum.Client },
        {
          conflicts,
          selfOverlap: selfOverlap(events, spacingMinutes),
          gapMinutes: spacingMinutes,
          driverName,
        },
      );
    }

    const response: OrderAvailabilityResponseModel = {
      availability,
      ...(driver && { driver }),
    };
    logger.info(i18next.t("orders.availability.logs.computed", { count: availability.length }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("orders.availability.computed"), response);
  } catch (error) {
    logger.error(i18next.t("orders.availability.logs.error", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.availability.error"),
    );
  }
};
