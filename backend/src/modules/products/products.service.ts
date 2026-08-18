import { AppError } from "../../core/errors/app-error.js";
import type { CategoriesRepository } from "../categories/categories.types.js";
import {
  type CreateProductInput,
  type Product,
  type ProductListOptions,
  type ProductPersistenceInput,
  productStatuses,
  ProductSkuConflictError,
  type ProductsRepository,
  productTypes,
  type UpdateProductInput,
} from "./products.types.js";

const skuPattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 160) {
    throw new AppError(
      "Product name must contain between 1 and 160 characters",
      400,
      "INVALID_PRODUCT_NAME",
    );
  }
  return normalized;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 5000) {
    throw new AppError(
      "Product description must not exceed 5000 characters",
      400,
      "INVALID_PRODUCT_DESCRIPTION",
    );
  }
  return normalized;
}

function normalizeSku(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0) return null;
  if (!skuPattern.test(normalized)) {
    throw new AppError("Invalid product SKU", 400, "INVALID_PRODUCT_SKU");
  }
  return normalized;
}

function normalizeQuantity(
  value: number | null | undefined,
  field: "minQuantity" | "maxQuantity",
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new AppError(
      `${field} must be a positive integer`,
      400,
      "INVALID_PRODUCT_QUANTITY",
    );
  }
  return value;
}

function validateQuantityRange(minQuantity: number | null, maxQuantity: number | null): void {
  if (minQuantity !== null && maxQuantity !== null && maxQuantity < minQuantity) {
    throw new AppError(
      "maxQuantity must be greater than or equal to minQuantity",
      400,
      "INVALID_PRODUCT_QUANTITY_RANGE",
    );
  }
}

function skuConflictError(): AppError {
  return new AppError(
    "Product SKU already exists in this business",
    409,
    "PRODUCT_SKU_CONFLICT",
  );
}

export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  private async requireCategory(businessId: string, categoryId: string | null): Promise<void> {
    if (categoryId === null) return;
    if (!(await this.categories.findById(businessId, categoryId))) {
      throw new AppError("Category not found", 404, "CATEGORY_NOT_FOUND");
    }
  }

  private async requireUniqueSku(
    businessId: string,
    sku: string | null,
    excludeProductId?: string,
  ): Promise<void> {
    if (sku && (await this.repository.findBySku(businessId, sku, excludeProductId))) {
      throw skuConflictError();
    }
  }

  async create(businessId: string, input: CreateProductInput): Promise<Product> {
    if (!productTypes.includes(input.type)) {
      throw new AppError("Invalid product type", 400, "INVALID_PRODUCT_TYPE");
    }
    const values: ProductPersistenceInput = {
      categoryId: input.categoryId ?? null,
      name: normalizeName(input.name),
      description: normalizeDescription(input.description),
      type: input.type,
      sku: normalizeSku(input.sku),
      minQuantity: normalizeQuantity(input.minQuantity, "minQuantity"),
      maxQuantity: normalizeQuantity(input.maxQuantity, "maxQuantity"),
      status: "active",
    };
    validateQuantityRange(values.minQuantity, values.maxQuantity);
    await this.requireCategory(businessId, values.categoryId);
    await this.requireUniqueSku(businessId, values.sku);

    try {
      return await this.repository.create(businessId, values);
    } catch (error) {
      if (error instanceof ProductSkuConflictError) throw skuConflictError();
      throw error;
    }
  }

  list(businessId: string, options: ProductListOptions): Promise<Product[]> {
    return this.repository.list(businessId, options);
  }

  async getById(businessId: string, productId: string): Promise<Product> {
    const product = await this.repository.findById(businessId, productId);
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    return product;
  }

  async update(
    businessId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<Product> {
    if (Object.keys(input).length === 0) {
      throw new AppError(
        "At least one product field must be provided",
        400,
        "EMPTY_PRODUCT_UPDATE",
      );
    }
    if (input.type !== undefined && !productTypes.includes(input.type)) {
      throw new AppError("Invalid product type", 400, "INVALID_PRODUCT_TYPE");
    }
    if (input.status !== undefined && !productStatuses.includes(input.status)) {
      throw new AppError("Invalid product status", 400, "INVALID_PRODUCT_STATUS");
    }

    const existing = await this.getById(businessId, productId);
    const values: ProductPersistenceInput = {
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      name: input.name === undefined ? existing.name : normalizeName(input.name),
      description:
        input.description === undefined
          ? existing.description
          : normalizeDescription(input.description),
      type: input.type ?? existing.type,
      sku: input.sku === undefined ? existing.sku : normalizeSku(input.sku),
      minQuantity:
        input.minQuantity === undefined
          ? existing.minQuantity
          : normalizeQuantity(input.minQuantity, "minQuantity"),
      maxQuantity:
        input.maxQuantity === undefined
          ? existing.maxQuantity
          : normalizeQuantity(input.maxQuantity, "maxQuantity"),
      status: input.status ?? existing.status,
    };
    validateQuantityRange(values.minQuantity, values.maxQuantity);
    await this.requireCategory(businessId, values.categoryId);
    await this.requireUniqueSku(businessId, values.sku, productId);

    try {
      const product = await this.repository.update(businessId, productId, values);
      if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
      return product;
    } catch (error) {
      if (error instanceof ProductSkuConflictError) throw skuConflictError();
      throw error;
    }
  }
}
