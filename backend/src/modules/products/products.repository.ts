import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import {
  type Product,
  type ProductListOptions,
  type ProductPersistenceInput,
  ProductSkuConflictError,
  type ProductsRepository,
  type ProductStatus,
  type ProductType,
} from "./products.types.js";

interface ProductRow extends QueryResultRow {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  sku: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  status: ProductStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

const productColumns = `id, business_id, category_id, name, description, type, sku,
  min_quantity, max_quantity, status, created_at, updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    businessId: row.business_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    type: row.type,
    sku: row.sku,
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function isSkuConflict(error: unknown): boolean {
  const postgresError = error as PostgreSqlError;
  return (
    postgresError.code === "23505" &&
    postgresError.constraint === "products_business_sku_unique"
  );
}

export class PostgresProductsRepository implements ProductsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(businessId: string, input: ProductPersistenceInput): Promise<Product> {
    try {
      const result = await this.db.query<ProductRow>(
        `INSERT INTO products (
           business_id, category_id, name, description, type, sku,
           min_quantity, max_quantity, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${productColumns}`,
        [
          businessId,
          input.categoryId,
          input.name,
          input.description,
          input.type,
          input.sku,
          input.minQuantity,
          input.maxQuantity,
          input.status,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created product");
      return mapProduct(row);
    } catch (error) {
      if (isSkuConflict(error)) throw new ProductSkuConflictError();
      throw error;
    }
  }

  async list(businessId: string, options: ProductListOptions): Promise<Product[]> {
    const result = await this.db.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       WHERE business_id = $1
         AND ($2::catalog_status IS NULL OR status = $2)
         AND ($3::product_type IS NULL OR type = $3)
         AND ($4::uuid IS NULL OR category_id = $4)
       ORDER BY created_at DESC, id DESC
       LIMIT $5 OFFSET $6`,
      [
        businessId,
        options.status ?? null,
        options.type ?? null,
        options.categoryId ?? null,
        options.limit,
        options.offset,
      ],
    );
    return result.rows.map(mapProduct);
  }

  async findById(businessId: string, productId: string): Promise<Product | null> {
    const result = await this.db.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       WHERE business_id = $1 AND id = $2`,
      [businessId, productId],
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async findBySku(
    businessId: string,
    sku: string,
    excludeProductId?: string,
  ): Promise<Product | null> {
    const result = await this.db.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       WHERE business_id = $1
         AND sku = $2
         AND ($3::uuid IS NULL OR id <> $3)`,
      [businessId, sku, excludeProductId ?? null],
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async update(
    businessId: string,
    productId: string,
    input: ProductPersistenceInput,
  ): Promise<Product | null> {
    try {
      const result = await this.db.query<ProductRow>(
        `UPDATE products
         SET category_id = $3,
             name = $4,
             description = $5,
             type = $6,
             sku = $7,
             min_quantity = $8,
             max_quantity = $9,
             status = $10,
             updated_at = now()
         WHERE business_id = $1 AND id = $2
         RETURNING ${productColumns}`,
        [
          businessId,
          productId,
          input.categoryId,
          input.name,
          input.description,
          input.type,
          input.sku,
          input.minQuantity,
          input.maxQuantity,
          input.status,
        ],
      );
      return result.rows[0] ? mapProduct(result.rows[0]) : null;
    } catch (error) {
      if (isSkuConflict(error)) throw new ProductSkuConflictError();
      throw error;
    }
  }
}
