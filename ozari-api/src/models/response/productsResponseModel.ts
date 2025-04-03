import { CurrencyModel } from '../common/currencyModel.js';

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
