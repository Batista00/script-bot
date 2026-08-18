export const productTypes = ["service", "product"] as const;
export const productStatuses = ["active", "inactive"] as const;

export type ProductType = (typeof productTypes)[number];
export type ProductStatus = (typeof productStatuses)[number];

export interface Product {
  id: string;
  businessId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  sku: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  categoryId?: string | null;
  name: string;
  description?: string | null;
  type: ProductType;
  sku?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
}

export interface UpdateProductInput {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  type?: ProductType;
  sku?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  status?: ProductStatus;
}

export interface ProductListOptions {
  limit: number;
  offset: number;
  status?: ProductStatus;
  type?: ProductType;
  categoryId?: string;
}

export interface ProductListQuery {
  limit?: string;
  offset?: string;
  status?: ProductStatus;
  type?: ProductType;
  categoryId?: string;
}

export interface ProductPersistenceInput {
  categoryId: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  sku: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  status: ProductStatus;
}

export class ProductSkuConflictError extends Error {
  constructor() {
    super("Product SKU already exists in this business");
    this.name = "ProductSkuConflictError";
  }
}

export interface ProductsRepository {
  create(businessId: string, input: ProductPersistenceInput): Promise<Product>;
  list(businessId: string, options: ProductListOptions): Promise<Product[]>;
  findById(businessId: string, productId: string): Promise<Product | null>;
  findBySku(
    businessId: string,
    sku: string,
    excludeProductId?: string,
  ): Promise<Product | null>;
  update(
    businessId: string,
    productId: string,
    input: ProductPersistenceInput,
  ): Promise<Product | null>;
}
