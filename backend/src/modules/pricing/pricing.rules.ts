import { AppError } from "../../core/errors/app-error.js";
import type { PricingType } from "./pricing.types.js";

export const maximumSafeMoney = Number.MAX_SAFE_INTEGER;
const maximumQuantity = 2_147_483_647;
const currencyPattern = /^[A-Z]{3}$/;

export function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!currencyPattern.test(currency)) {
    throw new AppError("Currency must contain exactly 3 ASCII letters", 400, "INVALID_CURRENCY");
  }
  return currency;
}

export function normalizeMoney(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(
      `${field} must be a positive safe integer`,
      400,
      "INVALID_MONEY_AMOUNT",
    );
  }
  return value;
}

export function normalizePricingQuantity(
  value: number | null | undefined,
  field: "minQuantity" | "maxQuantity",
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0 || value > maximumQuantity) {
    throw new AppError(`${field} must be a positive integer`, 400, "INVALID_PRICE_QUANTITY");
  }
  return value;
}

export function validatePricingRange(
  minQuantity: number | null,
  maxQuantity: number | null,
): void {
  if (minQuantity !== null && maxQuantity !== null && maxQuantity < minQuantity) {
    throw new AppError(
      "maxQuantity must be greater than or equal to minQuantity",
      400,
      "INVALID_PRICE_QUANTITY_RANGE",
    );
  }
}

export function validatePriceShape(
  pricingType: PricingType,
  fixedPrice: number | null,
  unitPrice: number | null,
): void {
  const validFixed = pricingType === "fixed" && fixedPrice !== null && unitPrice === null;
  const validUnit = pricingType === "unit" && unitPrice !== null && fixedPrice === null;
  if (!validFixed && !validUnit) {
    throw new AppError(
      "Price fields do not match pricingType",
      400,
      "INVALID_PRICE_CONFIGURATION",
    );
  }
}

export function multiplyMoney(unitPrice: number, quantity: number): number {
  const total = BigInt(unitPrice) * BigInt(quantity);
  if (total > BigInt(maximumSafeMoney)) {
    throw new AppError("Calculated price exceeds the safe API range", 400, "PRICE_OVERFLOW");
  }
  return Number(total);
}
