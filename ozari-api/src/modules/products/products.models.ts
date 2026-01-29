import type { CurrencyModel } from "@/models/common/currencyModel.js";

export interface CreateProductDetailRequestModel {
  detail: string;
  detailTypeId: number;
}

export interface CreateProductRequestModel {
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  description: string | undefined;
  imageUrl: string | undefined;
  name: string;
  productDetails: CreateProductDetailRequestModel[];
  quantity: number;
  rentPrice: number | undefined;
  sellPrice: number | undefined;
}

export interface UpdateProductDetailRequestModel extends CreateProductDetailRequestModel {
  id: number;
}

export interface UpdateProductRequestModel extends CreateProductRequestModel {
  id: number;
  productDetails: UpdateProductDetailRequestModel[];
}

export interface BaseProductDetailsResponseModel {
  detail: string;
  detailType: string;
  id: number;
}

export interface BaseProductResponseModel {
  businessType: string;
  category: string;
  currency: CurrencyModel;
  description: string | undefined;
  details: BaseProductDetailsResponseModel[];
  id: number;
  imageUrl: string | undefined;
  name: string;
  quantity: number;
  rentPrice: number | undefined;
  sellPrice: number | undefined;
}
