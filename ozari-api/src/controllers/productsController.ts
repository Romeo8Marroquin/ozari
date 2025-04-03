import { Response } from 'express';
import i18next from 'i18next';

import { prismaClient } from '../database/databaseClient.js';
import { logger } from '../logs/winstonConfig.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { sendOzariSuccess } from '../models/http/ozariSuccessModel.js';
import { CustomRequest } from '../models/middlewares/customRequestModel.js';
import { BaseProductResponseModel } from '../models/response/productsResponseModel.js';

export const getAllProducts = async (_: CustomRequest, res: Response): Promise<void> => {
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

export const getProductById = async (req: CustomRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const product = await prismaClient.product.findUnique({
      where: {
        id: parseInt(id),
      },
    });
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }
    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving product', error });
  }
};

export const createProduct = async (req: CustomRequest, res: Response): Promise<void> => {
  // const {
  //   name,
  //   description,
  //   imageUrl,
  //   productBusinessTypeId,
  //   productCategoryId,
  //   rentPrice,
  //   sellPrice,
  //   currencyId,
  //   quantity,
  // } = req.body;
  // try {
  //   const newProduct = await prismaClient.product.create({
  //     data: {
  //       name,
  //       description,
  //       imageUrl,
  //       productBusinessTypeId,
  //       productCategoryId,
  //       rentPrice,
  //       sellPrice,
  //       currencyId,
  //       quantity,
  //     },
  //   });
  res.status(201).json({});
  // } catch (error) {
  //   res.status(500).json({ message: 'Error creating product', error });
  // }
};

export const updateProduct = async (req: CustomRequest, res: Response): Promise<void> => {
  // const { id } = req.params;
  // const {
  //   name,
  //   description,
  //   imageUrl,
  //   productBusinessTypeId,
  //   productCategoryId,
  //   rentPrice,
  //   sellPrice,
  //   currencyId,
  //   quantity,
  // } = req.body;
  // try {
  //   const updatedProduct = await prismaClient.product.update({
  //     where: {
  //       id: parseInt(id),
  //     },
  //     data: {
  //       name,
  //       description,
  //       imageUrl,
  //       productBusinessTypeId,
  //       productCategoryId,
  //       rentPrice,
  //       sellPrice,
  //       currencyId,
  //       quantity,
  //     },
  //   });
  res.status(200).json({});
  // } catch (error) {
  //   res.status(500).json({ message: 'Error updating product', error });
  // }
};

export const deleteProduct = async (req: CustomRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const deletedProduct = await prismaClient.product.delete({
      where: {
        id: parseInt(id),
      },
    });
    res.status(200).json(deletedProduct);
  } catch (error) {
    res.status(500).json({ message: 'Error deleting product', error });
  }
};
