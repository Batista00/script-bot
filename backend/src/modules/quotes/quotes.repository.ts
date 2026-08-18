import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { PricingType } from "../pricing/pricing.types.js";
import {
  type Quote,
  type QuoteListOptions,
  type QuotePersistenceInput,
  type QuotesRepository,
  type QuoteStatus,
} from "./quotes.types.js";

interface QuoteRow extends QueryResultRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  product_id: string;
  quantity: number;
  product_name: string;
  currency: string;
  pricing_type: PricingType;
  unit_price: string | number | null;
  total_price: string | number;
  status: QuoteStatus;
  expires_at: Date | string | null;
  created_at: Date | string;
}

const quoteColumns = `id, business_id, customer_id, product_id, quantity, product_name,
  currency, pricing_type, unit_price, total_price, status, expires_at, created_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMoney(value: string | number): number {
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

function mapQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    productId: row.product_id,
    quantity: row.quantity,
    productName: row.product_name,
    currency: row.currency,
    pricingType: row.pricing_type,
    unitPrice: row.unit_price === null ? null : mapMoney(row.unit_price),
    totalPrice: mapMoney(row.total_price),
    status: row.status,
    expiresAt: row.expires_at === null ? null : toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
  };
}

export class PostgresQuotesRepository implements QuotesRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(businessId: string, input: QuotePersistenceInput): Promise<Quote> {
    const result = await this.db.query<QuoteRow>(
      `INSERT INTO quotes (
         business_id, customer_id, product_id, quantity, product_name, currency,
         pricing_type, unit_price, total_price, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${quoteColumns}`,
      [businessId, input.customerId, input.productId, input.quantity, input.productName,
        input.currency, input.pricingType, input.unitPrice, input.totalPrice, input.status,
        input.expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the created quote");
    return mapQuote(row);
  }

  async list(businessId: string, options: QuoteListOptions): Promise<Quote[]> {
    const result = await this.db.query<QuoteRow>(
      `SELECT ${quoteColumns}
       FROM quotes
       WHERE business_id = $1
         AND ($2::uuid IS NULL OR customer_id = $2)
         AND ($3::uuid IS NULL OR product_id = $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4 OFFSET $5`,
      [businessId, options.customerId ?? null, options.productId ?? null,
        options.limit, options.offset],
    );
    return result.rows.map(mapQuote);
  }

  async findById(businessId: string, quoteId: string): Promise<Quote | null> {
    const result = await this.db.query<QuoteRow>(
      `SELECT ${quoteColumns}
       FROM quotes
       WHERE business_id = $1 AND id = $2`,
      [businessId, quoteId],
    );
    return result.rows[0] ? mapQuote(result.rows[0]) : null;
  }
}
