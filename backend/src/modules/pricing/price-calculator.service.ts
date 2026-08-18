import { AppError } from "../../core/errors/app-error.js";
import type { ProductsRepository } from "../products/products.types.js";
import { multiplyMoney, normalizeCurrency } from "./pricing.rules.js";
import type { PriceCalculation, PricingRepository } from "./pricing.types.js";

export class PriceCalculatorService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly prices: PricingRepository,
  ) {}

  async calculate(
    businessId: string,
    productId: string,
    quantity: number,
    requestedCurrency: string,
  ): Promise<PriceCalculation> {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2_147_483_647) {
      throw new AppError("Quantity must be a positive integer", 400, "INVALID_QUOTE_QUANTITY");
    }
    const product = await this.products.findById(businessId, productId);
    if (!product) throw new AppError("Product not available", 404, "PRODUCT_NOT_AVAILABLE");
    if (product.status !== "active") {
      throw new AppError("Product not available", 409, "PRODUCT_NOT_AVAILABLE");
    }
    if (
      (product.minQuantity !== null && quantity < product.minQuantity) ||
      (product.maxQuantity !== null && quantity > product.maxQuantity)
    ) {
      throw new AppError(
        "Quantity is outside the product limits",
        409,
        "PRODUCT_NOT_AVAILABLE",
      );
    }

    const currency = normalizeCurrency(requestedCurrency);
    const price = await this.prices.findApplicableActive(
      businessId,
      productId,
      currency,
      quantity,
    );
    if (!price) throw new AppError("Price not available", 409, "PRICE_NOT_AVAILABLE");

    if (price.pricingType === "fixed") {
      if (price.fixedPrice === null) throw new Error("Invalid fixed price persisted");
      return {
        productId,
        productName: product.name,
        pricingType: "fixed",
        currency,
        unitPrice: null,
        totalPrice: price.fixedPrice,
      };
    }
    if (price.unitPrice === null) throw new Error("Invalid unit price persisted");
    return {
      productId,
      productName: product.name,
      pricingType: "unit",
      currency,
      unitPrice: price.unitPrice,
      totalPrice: multiplyMoney(price.unitPrice, quantity),
    };
  }
}
