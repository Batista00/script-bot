import type { Product, ProductStatus, ProductType } from "../products/products.types.js";
import type { ProductInputField } from "../products/product-inputs.js";
import type { ProductDelivery } from "../products/product-delivery.js";
import type { PricingType, ProductPrice } from "../pricing/pricing.types.js";
import type { ProductProviderMapping } from "./provider-catalog.types.js";

export interface ImportProviderServiceInput {
  deliveryConfig?: ProductDelivery | null;
  providerServiceId: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  sku?: string | null;
  type: ProductType;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  currency: string;
  pricingType: PricingType;
  retailPrice: number;
  status: ProductStatus;
  requiredInputs?: ProductInputField[];
}

export interface ImportProviderServiceResult {
  product: Product;
  price: ProductPrice;
  mapping: ProductProviderMapping;
}
