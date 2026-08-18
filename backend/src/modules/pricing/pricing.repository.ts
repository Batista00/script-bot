import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import {
  type PricingRepository,
  type PricingStatus,
  type PricingType,
  type ProductPrice,
  type ProductPriceListOptions,
  type ProductPricePersistenceInput,
  PriceRangeConflictError,
} from "./pricing.types.js";

interface ProductPriceRow extends QueryResultRow {
  id: string;
  business_id: string;
  product_id: string;
  pricing_type: PricingType;
  currency: string;
  fixed_price: string | number | null;
  unit_price: string | number | null;
  min_quantity: number | null;
  max_quantity: number | null;
  status: PricingStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

const priceColumns = `id, business_id, product_id, pricing_type, currency,
  fixed_price, unit_price, min_quantity, max_quantity, status, created_at, updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMoney(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("PostgreSQL returned a monetary amount outside the safe API range");
    }
    return value;
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("PostgreSQL returned a monetary amount outside the safe API range");
  }
  return Number(parsed);
}

function mapProductPrice(row: ProductPriceRow): ProductPrice {
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    pricingType: row.pricing_type,
    currency: row.currency,
    fixedPrice: mapMoney(row.fixed_price),
    unitPrice: mapMoney(row.unit_price),
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function isRangeConflict(error: unknown): boolean {
  const postgresError = error as PostgreSqlError;
  return (
    postgresError.code === "23P01" &&
    postgresError.constraint === "product_prices_active_range_exclusion"
  );
}

export class PostgresPricingRepository implements PricingRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    productId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice> {
    try {
      const result = await this.db.query<ProductPriceRow>(
        `INSERT INTO product_prices (
           business_id, product_id, pricing_type, currency, fixed_price, unit_price,
           min_quantity, max_quantity, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${priceColumns}`,
        [businessId, productId, input.pricingType, input.currency, input.fixedPrice,
          input.unitPrice, input.minQuantity, input.maxQuantity, input.status],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created product price");
      return mapProductPrice(row);
    } catch (error) {
      if (isRangeConflict(error)) throw new PriceRangeConflictError();
      throw error;
    }
  }

  async list(
    businessId: string,
    productId: string,
    options: ProductPriceListOptions,
  ): Promise<ProductPrice[]> {
    const result = await this.db.query<ProductPriceRow>(
      `SELECT ${priceColumns}
       FROM product_prices
       WHERE business_id = $1 AND product_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [businessId, productId, options.limit, options.offset],
    );
    return result.rows.map(mapProductPrice);
  }

  async findById(
    businessId: string,
    productId: string,
    priceId: string,
  ): Promise<ProductPrice | null> {
    const result = await this.db.query<ProductPriceRow>(
      `SELECT ${priceColumns}
       FROM product_prices
       WHERE business_id = $1 AND product_id = $2 AND id = $3`,
      [businessId, productId, priceId],
    );
    return result.rows[0] ? mapProductPrice(result.rows[0]) : null;
  }

  async findActiveRangeConflict(
    businessId: string,
    productId: string,
    currency: string,
    minQuantity: number | null,
    maxQuantity: number | null,
    excludePriceId?: string,
  ): Promise<ProductPrice | null> {
    const result = await this.db.query<ProductPriceRow>(
      `SELECT ${priceColumns}
       FROM product_prices
       WHERE business_id = $1
         AND product_id = $2
         AND currency = $3
         AND status = 'active'
         AND (min_quantity IS NULL OR $5::integer IS NULL OR min_quantity <= $5)
         AND (max_quantity IS NULL OR $4::integer IS NULL OR max_quantity >= $4)
         AND ($6::uuid IS NULL OR id <> $6)
       LIMIT 1`,
      [businessId, productId, currency, minQuantity, maxQuantity, excludePriceId ?? null],
    );
    return result.rows[0] ? mapProductPrice(result.rows[0]) : null;
  }

  async findApplicableActive(
    businessId: string,
    productId: string,
    currency: string,
    quantity: number,
  ): Promise<ProductPrice | null> {
    const result = await this.db.query<ProductPriceRow>(
      `SELECT ${priceColumns}
       FROM product_prices
       WHERE business_id = $1
         AND product_id = $2
         AND currency = $3
         AND status = 'active'
         AND (min_quantity IS NULL OR min_quantity <= $4)
         AND (max_quantity IS NULL OR max_quantity >= $4)
       LIMIT 1`,
      [businessId, productId, currency, quantity],
    );
    return result.rows[0] ? mapProductPrice(result.rows[0]) : null;
  }

  async update(
    businessId: string,
    productId: string,
    priceId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice | null> {
    try {
      const result = await this.db.query<ProductPriceRow>(
        `UPDATE product_prices
         SET pricing_type = $4, currency = $5, fixed_price = $6, unit_price = $7,
             min_quantity = $8, max_quantity = $9, status = $10, updated_at = now()
         WHERE business_id = $1 AND product_id = $2 AND id = $3
         RETURNING ${priceColumns}`,
        [businessId, productId, priceId, input.pricingType, input.currency,
          input.fixedPrice, input.unitPrice, input.minQuantity, input.maxQuantity,
          input.status],
      );
      return result.rows[0] ? mapProductPrice(result.rows[0]) : null;
    } catch (error) {
      if (isRangeConflict(error)) throw new PriceRangeConflictError();
      throw error;
    }
  }
}
