export const pricingTypes = ["fixed", "unit"] as const;
export const pricingStatuses = ["active", "inactive"] as const;

export type PricingType = (typeof pricingTypes)[number];
export type PricingStatus = (typeof pricingStatuses)[number];

export interface ProductPrice {
  id: string;
  businessId: string;
  productId: string;
  pricingType: PricingType;
  currency: string;
  fixedPrice: number | null;
  unitPrice: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  status: PricingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductPriceInput {
  pricingType: PricingType;
  currency: string;
  fixedPrice?: number | null;
  unitPrice?: number | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
}

export interface UpdateProductPriceInput {
  pricingType?: PricingType;
  currency?: string;
  fixedPrice?: number | null;
  unitPrice?: number | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  status?: PricingStatus;
}

export interface ProductPricePersistenceInput {
  pricingType: PricingType;
  currency: string;
  fixedPrice: number | null;
  unitPrice: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  status: PricingStatus;
}

export interface ProductPriceListOptions {
  limit: number;
  offset: number;
}

export interface ProductPriceListQuery {
  limit?: string;
  offset?: string;
}

export class PriceRangeConflictError extends Error {
  constructor() {
    super("Active price range overlaps another rule");
    this.name = "PriceRangeConflictError";
  }
}

export interface PricingRepository {
  create(
    businessId: string,
    productId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice>;
  list(
    businessId: string,
    productId: string,
    options: ProductPriceListOptions,
  ): Promise<ProductPrice[]>;
  findById(
    businessId: string,
    productId: string,
    priceId: string,
  ): Promise<ProductPrice | null>;
  findActiveRangeConflict(
    businessId: string,
    productId: string,
    currency: string,
    minQuantity: number | null,
    maxQuantity: number | null,
    excludePriceId?: string,
  ): Promise<ProductPrice | null>;
  findApplicableActive(
    businessId: string,
    productId: string,
    currency: string,
    quantity: number,
  ): Promise<ProductPrice | null>;
  update(
    businessId: string,
    productId: string,
    priceId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice | null>;
}

export interface PriceCalculation {
  productId: string;
  productName: string;
  pricingType: PricingType;
  currency: string;
  unitPrice: number | null;
  totalPrice: number;
}
