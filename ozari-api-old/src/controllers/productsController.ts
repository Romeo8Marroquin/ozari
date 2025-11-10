import { Request, Response } from 'express';
import i18next from 'i18next';

import { prismaClient } from '../database/databaseClient.js';
import { logger } from '../logs/winstonConfig.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { sendOzariSuccess } from '../models/http/ozariSuccessModel.js';
import {
  CreateProductRequestModel,
  UpdateProductRequestModel,
} from '../models/request/productsRequestModels.js';
import { BaseProductResponseModel } from '../models/response/productsResponseModel.js';

export const getAllProducts = async (_: Request, res: Response): Promise<void> => {
  try {
    const rawProducts = await prismaClient.product.findMany({
      include: {
        businessType: { select: { name: true } },
        category: { select: { name: true } },
        currency: { select: { id: true, iso4217Code: true, name: true, symbol: true } },
        productDetails: {
          select: {
            detail: true,
            detailType: { select: { name: true } },
            id: true,
          },
          where: { isActive: true },
        },
      },
      where: {
        businessType: { isActive: true },
        category: { isActive: true },
        currency: { isActive: true },
        isActive: true,
      },
    });

    const products: BaseProductResponseModel[] = rawProducts.map((product) => ({
      businessType: product.businessType.name,
      category: product.category.name,
      currency: {
        id: product.currency.id,
        iso4217Code: product.currency.iso4217Code,
        name: product.currency.name,
        symbol: product.currency.symbol,
      },
      description: product.description ?? undefined,
      details: product.productDetails.map((detail) => ({
        detail: detail.detail,
        detailType: detail.detailType.name,
        id: detail.id,
      })),
      id: product.id,
      imageUrl: product.imageUrl ?? undefined,
      name: product.name,
      quantity: product.quantity,
      rentPrice: product.rentPrice ? Number(product.rentPrice) : undefined,
      sellPrice: product.sellPrice ? Number(product.sellPrice) : undefined,
    }));

    logger.info(
      i18next.t('products.getAllProducts.logs.productsFetched', { count: rawProducts.length }),
    );
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('products.getAllProducts.productsFetched'), {
      products,
    });
  } catch (error) {
    logger.error(i18next.t('products.getAllProducts.logs.errorFetchingProducts', { error }));
    sendOzariSuccess(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('products.getAllProducts.errorFetchingProducts'),
    );
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  const {
    businessTypeId,
    categoryId,
    currencyId,
    description,
    imageUrl,
    name,
    productDetails,
    quantity,
    rentPrice,
    sellPrice,
  } = req.body as CreateProductRequestModel;
  try {
    const createdProduct = await prismaClient.product.create({
      data: {
        currencyId: currencyId,
        description,
        imageUrl,
        name,
        productBusinessTypeId: businessTypeId,
        productCategoryId: categoryId,
        productDetails: {
          create: productDetails.map((detail) => ({
            detail: detail.detail,
            productDetailTypeId: detail.detailTypeId,
          })),
        },
        quantity,
        rentPrice,
        sellPrice,
      },
      include: {
        businessType: { select: { name: true } },
        category: { select: { name: true } },
        currency: { select: { id: true, iso4217Code: true, name: true, symbol: true } },
        productDetails: {
          select: {
            detail: true,
            detailType: { select: { name: true } },
            id: true,
          },
          where: { isActive: true },
        },
      },
    });
    const responseProduct: BaseProductResponseModel = {
      businessType: createdProduct.businessType.name,
      category: createdProduct.category.name,
      currency: {
        id: createdProduct.currency.id,
        iso4217Code: createdProduct.currency.iso4217Code,
        name: createdProduct.currency.name,
        symbol: createdProduct.currency.symbol,
      },
      description: createdProduct.description ?? undefined,
      details: createdProduct.productDetails.map((detail) => ({
        detail: detail.detail,
        detailType: detail.detailType.name,
        id: detail.id,
      })),
      id: createdProduct.id,
      imageUrl: createdProduct.imageUrl ?? undefined,
      name: createdProduct.name,
      quantity: createdProduct.quantity,
      rentPrice: createdProduct.rentPrice ? Number(createdProduct.rentPrice) : undefined,
      sellPrice: createdProduct.sellPrice ? Number(createdProduct.sellPrice) : undefined,
    };
    logger.info(i18next.t('products.createProduct.logs.productCreated', { id: createdProduct.id }));
    sendOzariSuccess(res, HttpEnum.CREATED, i18next.t('products.createProduct.productCreated'), {
      product: responseProduct,
    });
  } catch (error) {
    logger.error(i18next.t('products.createProduct.logs.errorCreatingProduct', { error }));
    sendOzariSuccess(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('products.createProduct.errorCreatingProduct'),
    );
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  const {
    businessTypeId,
    categoryId,
    currencyId,
    description,
    id,
    imageUrl,
    name,
    productDetails,
    quantity,
    rentPrice,
    sellPrice,
  } = req.body as UpdateProductRequestModel;
  try {
    const createdProduct = await prismaClient.product.update({
      data: {
        currencyId: currencyId,
        description,
        imageUrl,
        name,
        productBusinessTypeId: businessTypeId,
        productCategoryId: categoryId,
        productDetails: {
          updateMany: productDetails.map((detail) => ({
            data: {
              detail: detail.detail,
              productDetailTypeId: detail.detailTypeId,
            },
            where: { id: detail.id },
          })),
        },
        quantity,
        rentPrice,
        sellPrice,
      },
      where: { id },
    });
    logger.info(i18next.t('products.updateProduct.logs.productUpdated', { id: createdProduct.id }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('products.updateProduct.productUpdated'));
  } catch (error) {
    logger.error(i18next.t('products.updateProduct.logs.genericError', { error }));
    sendOzariSuccess(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('products.updateProduct.genericError'),
    );
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.query;
  const parsedId = Number(id);
  try {
    await prismaClient.product.update({
      data: {
        isActive: false,
        productDetails: {
          updateMany: {
            data: { isActive: false },
            where: {},
          },
        },
      },
      where: { id: parsedId },
    });
    logger.info(i18next.t('products.deleteProduct.logs.productDeleted', { id }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('products.deleteProduct.productDeleted'));
  } catch (error) {
    logger.error(i18next.t('products.deleteProduct.logs.genericError', { error }));
    sendOzariSuccess(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('products.deleteProduct.genericError'),
    );
  }
};
