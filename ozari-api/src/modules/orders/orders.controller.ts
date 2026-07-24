import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { PaymentStatusEnum } from "@models/enums/paymentStatusEnum.js";
import { ServiceStatusEnum } from "@models/enums/serviceStatusEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { buildPaginationMeta } from "../products/products.service.js";
import {
  type CreateOrderRequestModel,
  type OrderAvailabilityRequestModel,
  type OrderAvailabilityResponseModel,
  type OrderCatalogResponseModel,
  type OrderDetailEnvelopeModel,
  type OrderListResponseModel,
  type OrderStockConflictItemModel,
  type ProductAvailabilityModel,
} from "./orders.models.js";
import {
  OrderSpacingConflictError,
  OrderStockConflictError,
  buildOrderListWhere,
  buildRentedInWindowWhere,
  buildSpacingConflictWhere,
  computeBilledDays,
  orderListInclude,
  orderListOrderBy,
  parseOrderListQuery,
  parseSpacingMinutes,
  priceOrderLine,
  projectOrderDetail,
  projectOrderListItem,
  richOrderInclude,
  type PricedOrderLineModel,
} from "./orders.service.js";

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
    const prismaClient = await getPrismaClient();
    const where = buildOrderListWhere(query);

    const [rows, total] = await Promise.all([
      prismaClient.service.findMany({
        where,
        include: orderListInclude,
        orderBy: orderListOrderBy(query.view),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prismaClient.service.count({ where }),
    ]);

    const response: OrderListResponseModel = {
      orders: rows.map(projectOrderListItem),
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

    const prismaClient = await getPrismaClient();
    const rawOrder = validId
      ? await prismaClient.service.findFirst({
          where: { id, isActive: true },
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
      order: projectOrderDetail(rawOrder),
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

      // Availability, under the lock: rentals against the window, sales against remaining stock.
      const rentalIds = pricedLines.filter((line) => line.isRental).map((line) => line.productId);
      const rentedRows =
        rentalIds.length > 0 && body.pickupAt
          ? await tx.serviceDetail.groupBy({
              by: ["productId"],
              where: buildRentedInWindowWhere(rentalIds, body.deliveryAt, body.pickupAt),
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

      // The single-vehicle spacing rule — the hour is an admin preference, never hardcoded.
      const preference = await tx.appPreference.findUnique({
        where: { key: "orders.logisticsSpacingMinutes" },
        select: { value: true },
      });
      const spacingMinutes = parseSpacingMinutes(preference?.value);
      const events = [body.deliveryAt, ...(body.pickupAt ? [body.pickupAt] : [])];
      const spacingConflict = await tx.service.findFirst({
        where: buildSpacingConflictWhere(events, spacingMinutes),
        select: { id: true, deliveryAt: true },
      });
      if (spacingConflict) {
        throw new OrderSpacingConflictError(spacingConflict.deliveryAt);
      }

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
          paymentMethodId: body.paymentMethodId ?? null,
          currencyId,
          serviceStatusId: ServiceStatusEnum.PENDING,
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
            create: { toStatusId: ServiceStatusEnum.PENDING, byUserId },
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

    const response: OrderDetailEnvelopeModel = { order: projectOrderDetail(created) };
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
    if (error instanceof OrderSpacingConflictError) {
      logger.warn(
        i18next.t("orders.createOrder.logs.spacingConflict", {
          conflictAt: error.conflictAt.toISOString(),
        }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("orders.createOrder.spacingConflict"),
      );
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
    const [eventTypes, serviceStatuses, paymentStatuses, paymentMethods, contactTypes, zoneRows] =
      await Promise.all([
        prismaClient.eventType.findMany({
          ...option,
          select: { id: true, name: true, minLeadHours: true },
        }),
        prismaClient.serviceStatus.findMany(option),
        prismaClient.paymentStatus.findMany(option),
        prismaClient.paymentMethod.findMany(option),
        prismaClient.contactType.findMany(option),
        prismaClient.zone.findMany({
          ...option,
          select: { id: true, name: true, deliveryFee: true },
        }),
      ]);

    const response: OrderCatalogResponseModel = {
      eventTypes,
      serviceStatuses,
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
 * `POST /orders/availability` — the admin's live per-window availability probe (EPIC-2 §10.C): for
 * the requested products + window, return each product's takeable amount so the order form can
 * annotate the picker and reconcile picked lines. Rentals are fleet minus what's held in the window
 * (only computable once a pickup exists → `null` otherwise); sales are current stock (window-
 * independent). Exact counts — the ADMIN runs the business (§11.A); a Client tier would cap instead.
 * A pure read (no lock): a create still re-checks under the product lock, so this is advisory.
 */
export const getOrderAvailability = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as OrderAvailabilityRequestModel;
    const prismaClient = await getPrismaClient();
    const products = await prismaClient.product.findMany({
      where: { id: { in: body.productIds }, isActive: true },
      select: { id: true, quantity: true, productBusinessTypeId: true },
    });
    const rentalIds = products
      .filter((product) => product.productBusinessTypeId === BusinessTypeEnum.RENT)
      .map((product) => product.id);
    const rentedRows =
      rentalIds.length > 0 && body.pickupAt
        ? await prismaClient.serviceDetail.groupBy({
            by: ["productId"],
            where: buildRentedInWindowWhere(rentalIds, body.deliveryAt, body.pickupAt),
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

    const response: OrderAvailabilityResponseModel = { availability };
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
