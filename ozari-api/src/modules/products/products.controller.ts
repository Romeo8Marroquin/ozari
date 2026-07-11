import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  type CreateProductRequestModel,
  type ProductCatalogResponseModel,
  type ProductListResponseModel,
} from "./products.models.js";
import {
  buildPaginationMeta,
  buildProductListWhere,
  parseProductListQuery,
  projectProductForRole,
  richProductInclude,
} from "./products.service.js";

/**
 * `GET /products` — the paginated product catalog. Available to **every authenticated role**; the
 * response is **role-projected** so each role sees only the fields it should (minimum privilege — the
 * exact stock count is Admin-only, an in-stock signal is Employee+, everything else is shared). Row
 * visibility is uniform (the active catalog); the role axis is the *fields* (`projectProductForRole`).
 */
export const getProducts = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    // Role is DB-verified in verifyJwt; fall back to the least-privileged view if somehow absent.
    const role = req.user?.userRole ?? RolesEnum.Client;
    const { page, pageSize } = parseProductListQuery(req.query);

    const prismaClient = await getPrismaClient();
    const where = buildProductListWhere();
    const [rawProducts, total] = await Promise.all([
      prismaClient.product.findMany({
        where,
        include: richProductInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prismaClient.product.count({ where }),
    ]);

    const response: ProductListResponseModel = {
      products: rawProducts.map((product) =>
        projectProductForRole(product, role),
      ),
      pagination: buildPaginationMeta(page, pageSize, total),
    };

    logger.info(
      i18next.t("products.getAllProducts.logs.productsFetched", {
        count: total,
      }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.getAllProducts.productsFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("products.getAllProducts.logs.errorFetchingProducts", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.getAllProducts.errorFetchingProducts"),
    );
  }
};

/**
 * `GET /products/catalog` — the seeded reference lists the create/edit form renders as selects
 * (business types, categories, currencies, rent time units, detail types), id + name only, active
 * rows, id order. Available to any authenticated role: it's public reference data (the names already
 * appear on every projected product) and employee-facing filters will consume it later.
 */
export const getProductCatalog = async (
  _req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const option = { where: { isActive: true }, orderBy: { id: "asc" }, select: { id: true, name: true } } as const;
    const [businessTypes, categories, currencies, detailTypes, rentTimeUnits] =
      await Promise.all([
        prismaClient.productBusinessType.findMany(option),
        prismaClient.productCategory.findMany(option),
        prismaClient.currency.findMany({
          ...option,
          select: { id: true, name: true, iso4217Code: true, symbol: true },
        }),
        prismaClient.productDetailType.findMany(option),
        prismaClient.rentTimeUnit.findMany(option),
      ]);

    const response: ProductCatalogResponseModel = {
      businessTypes,
      categories,
      currencies,
      detailTypes,
      rentTimeUnits,
    };

    logger.info(i18next.t("products.catalog.logs.catalogFetched"));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.catalog.catalogFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("products.catalog.logs.errorFetchingCatalog", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.catalog.errorFetchingCatalog"),
    );
  }
};

/**
 * `POST /products` — create a product (+ nested details). **Admin only** (`isGrantedRoles` on the
 * route; the validator has already enforced the conditional price rule and sanitized the body).
 * The response is the SAME role-projected item shape the list returns (`projectProductForRole`
 * over a `richProductInclude` fetch), so the frontend cache can absorb it without translation.
 * A product is created without images — the gallery is a separate flow that attaches them later.
 */
export const createProduct = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as CreateProductRequestModel;
    // Fail-closed like the reads: the route guarantees Admin, but never assume it here.
    const role = req.user?.userRole ?? RolesEnum.Client;

    const prismaClient = await getPrismaClient();
    const created = await prismaClient.product.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        productBusinessTypeId: body.businessTypeId,
        productCategoryId: body.categoryId,
        currencyId: body.currencyId,
        quantity: body.quantity,
        rentPrice: body.rentPrice ?? null,
        sellPrice: body.sellPrice ?? null,
        replacementPrice: body.replacementPrice ?? null,
        rentTimeUnitId: body.rentTimeUnitId ?? null,
        ...(body.productDetails.length > 0 && {
          productDetails: {
            create: body.productDetails.map((detail) => ({
              productDetailTypeId: detail.detailTypeId,
              detail: detail.detail,
            })),
          },
        }),
      },
      include: richProductInclude,
    });

    logger.info(
      i18next.t("products.createProduct.logs.productCreated", {
        id: created.id,
        name: created.name,
      }),
    );

    // Audit log: product created (deployed environments only, like every audit event).
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Product ID ${created.id}`,
        success: true,
        metadata: { operation: "PRODUCT_CREATED" },
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.CREATED,
      i18next.t("products.createProduct.productCreated"),
      projectProductForRole(created, role),
    );
  } catch (error) {
    logger.error(
      i18next.t("products.createProduct.logs.errorCreatingProduct", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.createProduct.errorCreatingProduct"),
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WIP: update / delete are Admin-only writes, kept commented until they're rebuilt against the new
// Product shape (conditional pricing, fix-style detail updates, soft-delete cascade). Create is
// live above — follow its shape when rebuilding these.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// export const updateProduct = async (req, res) => { ... };
// export const deleteProduct = async (req, res) => { ... };
