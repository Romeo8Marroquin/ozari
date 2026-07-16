import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { buildPaginationMeta } from "../products/products.service.js";
import {
  type OrderCatalogResponseModel,
  type OrderDetailEnvelopeModel,
  type OrderListResponseModel,
} from "./orders.models.js";
import {
  buildOrderListWhere,
  orderListInclude,
  orderListOrderBy,
  parseOrderListQuery,
  projectOrderDetail,
  projectOrderListItem,
  richOrderInclude,
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
 * `GET /orders/catalog` — the seeded reference lists the orders section consumes: event types
 * (with their client lead-times), the status vocabularies for filters/chips, and the contact
 * types + zones the client-registry form needs. Active rows, id order, id + name only (plus
 * `minLeadHours` on event types). **Admin only**, like every orders read today.
 */
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
    const [eventTypes, serviceStatuses, paymentStatuses, contactTypes, zones] =
      await Promise.all([
        prismaClient.eventType.findMany({
          ...option,
          select: { id: true, name: true, minLeadHours: true },
        }),
        prismaClient.serviceStatus.findMany(option),
        prismaClient.paymentStatus.findMany(option),
        prismaClient.contactType.findMany(option),
        prismaClient.zone.findMany(option),
      ]);

    const response: OrderCatalogResponseModel = {
      eventTypes,
      serviceStatuses,
      paymentStatuses,
      contactTypes,
      zones,
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
