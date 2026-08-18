import { AppError } from "../../core/errors/app-error.js";
import type { ProductsRepository } from "../products/products.types.js";
import {
  normalizeCurrency,
  normalizeMoney,
  normalizePricingQuantity,
  validatePriceShape,
  validatePricingRange,
} from "./pricing.rules.js";
import {
  type CreateProductPriceInput,
  PriceRangeConflictError,
  type PricingRepository,
  pricingStatuses,
  pricingTypes,
  type ProductPrice,
  type ProductPriceListOptions,
  type ProductPricePersistenceInput,
  type UpdateProductPriceInput,
} from "./pricing.types.js";

function rangeConflictError(): AppError {
  return new AppError(
    "Active price range overlaps another rule",
    409,
    "PRICE_RANGE_CONFLICT",
  );
}

export class PricingService {
  constructor(
    private readonly repository: PricingRepository,
    private readonly products: ProductsRepository,
  ) {}

  private async requireProduct(businessId: string, productId: string): Promise<void> {
    if (!(await this.products.findById(businessId, productId))) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
  }

  private async requireAvailableRange(
    businessId: string,
    productId: string,
    values: ProductPricePersistenceInput,
    excludePriceId?: string,
  ): Promise<void> {
    if (values.status === "inactive") return;
    const conflict = await this.repository.findActiveRangeConflict(
      businessId,
      productId,
      values.currency,
      values.minQuantity,
      values.maxQuantity,
      excludePriceId,
    );
    if (conflict) throw rangeConflictError();
  }

  async create(
    businessId: string,
    productId: string,
    input: CreateProductPriceInput,
  ): Promise<ProductPrice> {
    if (!pricingTypes.includes(input.pricingType)) {
      throw new AppError("Invalid pricing type", 400, "INVALID_PRICING_TYPE");
    }
    const values: ProductPricePersistenceInput = {
      pricingType: input.pricingType,
      currency: normalizeCurrency(input.currency),
      fixedPrice: normalizeMoney(input.fixedPrice, "fixedPrice"),
      unitPrice: normalizeMoney(input.unitPrice, "unitPrice"),
      minQuantity: normalizePricingQuantity(input.minQuantity, "minQuantity"),
      maxQuantity: normalizePricingQuantity(input.maxQuantity, "maxQuantity"),
      status: "active",
    };
    validatePriceShape(values.pricingType, values.fixedPrice, values.unitPrice);
    validatePricingRange(values.minQuantity, values.maxQuantity);
    await this.requireProduct(businessId, productId);
    await this.requireAvailableRange(businessId, productId, values);

    try {
      return await this.repository.create(businessId, productId, values);
    } catch (error) {
      if (error instanceof PriceRangeConflictError) throw rangeConflictError();
      throw error;
    }
  }

  list(
    businessId: string,
    productId: string,
    options: ProductPriceListOptions,
  ): Promise<ProductPrice[]> {
    return this.repository.list(businessId, productId, options);
  }

  async getById(
    businessId: string,
    productId: string,
    priceId: string,
  ): Promise<ProductPrice> {
    const price = await this.repository.findById(businessId, productId, priceId);
    if (!price) throw new AppError("Price not found", 404, "PRICE_NOT_FOUND");
    return price;
  }

  async update(
    businessId: string,
    productId: string,
    priceId: string,
    input: UpdateProductPriceInput,
  ): Promise<ProductPrice> {
    if (Object.keys(input).length === 0) {
      throw new AppError("At least one price field must be provided", 400, "EMPTY_PRICE_UPDATE");
    }
    if (input.pricingType !== undefined && !pricingTypes.includes(input.pricingType)) {
      throw new AppError("Invalid pricing type", 400, "INVALID_PRICING_TYPE");
    }
    if (input.status !== undefined && !pricingStatuses.includes(input.status)) {
      throw new AppError("Invalid pricing status", 400, "INVALID_PRICING_STATUS");
    }

    await this.requireProduct(businessId, productId);
    const existing = await this.getById(businessId, productId, priceId);
    const pricingType = input.pricingType ?? existing.pricingType;
    const changedToFixed = input.pricingType === "fixed" && existing.pricingType !== "fixed";
    const changedToUnit = input.pricingType === "unit" && existing.pricingType !== "unit";
    const values: ProductPricePersistenceInput = {
      pricingType,
      currency: input.currency === undefined ? existing.currency : normalizeCurrency(input.currency),
      fixedPrice:
        input.fixedPrice === undefined
          ? changedToUnit ? null : existing.fixedPrice
          : normalizeMoney(input.fixedPrice, "fixedPrice"),
      unitPrice:
        input.unitPrice === undefined
          ? changedToFixed ? null : existing.unitPrice
          : normalizeMoney(input.unitPrice, "unitPrice"),
      minQuantity:
        input.minQuantity === undefined
          ? existing.minQuantity
          : normalizePricingQuantity(input.minQuantity, "minQuantity"),
      maxQuantity:
        input.maxQuantity === undefined
          ? existing.maxQuantity
          : normalizePricingQuantity(input.maxQuantity, "maxQuantity"),
      status: input.status ?? existing.status,
    };
    validatePriceShape(values.pricingType, values.fixedPrice, values.unitPrice);
    validatePricingRange(values.minQuantity, values.maxQuantity);
    await this.requireAvailableRange(businessId, productId, values, priceId);

    try {
      const price = await this.repository.update(businessId, productId, priceId, values);
      if (!price) throw new AppError("Price not found", 404, "PRICE_NOT_FOUND");
      return price;
    } catch (error) {
      if (error instanceof PriceRangeConflictError) throw rangeConflictError();
      throw error;
    }
  }
}
