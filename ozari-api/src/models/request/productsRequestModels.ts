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
