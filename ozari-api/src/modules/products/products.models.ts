import { CurrencyModel } from '@models/common/currencyModel';

export interface CreateProductDetailRequestModel {
  detail: string;
  detailTypeId: number;
}

export interface CreateProductRequestModel {
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  description?: string;
  imageUrl?: string;
  name: string;
  productDetails: CreateProductDetailRequestModel[];
  quantity: number;
  rentPrice?: number;
  sellPrice?: number;
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
  description?: string;
  details: BaseProductDetailsResponseModel[];
  id: number;
  imageUrl?: string;
  name: string;
  quantity: number;
  rentPrice?: number;
  sellPrice?: number;
}
