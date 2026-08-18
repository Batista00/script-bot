import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { PricingType } from "../pricing/pricing.types.js";
import type { QuoteStatus } from "../quotes/quotes.types.js";
import {
  type Order,
  type OrderCustomer,
  type OrderItem,
  type OrderItemPersistenceInput,
  type OrderListOptions,
  type OrderPersistenceInput,
  type OrderQuoteSnapshot,
  type OrdersRepository,
  type OrderStatus,
  QuoteConversionConflictError,
} from "./orders.types.js";

interface OrderRow extends QueryResultRow {
  id: string;
  business_id: string;
  customer_id: string;
  quote_id: string;
  status: OrderStatus;
  currency: string;
  subtotal: string | number;
  total: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OrderItemRow extends QueryResultRow {
  id: string;
  business_id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  pricing_type: PricingType;
  unit_price: string | number | null;
  total_price: string | number;
  created_at: Date | string;
}

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
}

interface CustomerRow extends QueryResultRow {
  id: string;
  status: "active" | "inactive";
}

interface PostgreSqlError { code?: string; constraint?: string }

const orderColumns = `id, business_id, customer_id, quote_id, status, currency,
  subtotal, total, created_at, updated_at`;
const itemColumns = `id, business_id, order_id, product_id, product_name, quantity,
  pricing_type, unit_price, total_price, created_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMoney(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("PostgreSQL returned money outside the safe API range");
    }
    return value;
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("PostgreSQL returned money outside the safe API range");
  }
  return Number(parsed);
}

function mapItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    pricingType: row.pricing_type,
    unitPrice: row.unit_price === null ? null : mapMoney(row.unit_price),
    totalPrice: mapMoney(row.total_price),
    createdAt: toIsoString(row.created_at),
  };
}

function mapOrder(row: OrderRow, items: OrderItem[] = []): Order {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    quoteId: row.quote_id,
    status: row.status,
    currency: row.currency,
    subtotal: mapMoney(row.subtotal),
    total: mapMoney(row.total),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    items,
  };
}

function isQuoteConflict(error: unknown): boolean {
  const pgError = error as PostgreSqlError;
  return pgError.code === "23505" && pgError.constraint === "orders_quote_id_unique";
}

export class PostgresOrdersRepository implements OrdersRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async findQuoteForConversion(
    businessId: string,
    quoteId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderQuoteSnapshot | null> {
    const result = await executor.query<QuoteRow>(
      `SELECT id, business_id, customer_id, product_id, quantity, product_name,
              currency, pricing_type, unit_price, total_price, status, expires_at
       FROM quotes
       WHERE business_id = $1 AND id = $2
       FOR UPDATE`,
      [businessId, quoteId],
    );
    const row = result.rows[0];
    return row ? {
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
    } : null;
  }

  async findCustomerForConversion(
    businessId: string,
    customerId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderCustomer | null> {
    const result = await executor.query<CustomerRow>(
      `SELECT id, status FROM customers WHERE business_id = $1 AND id = $2`,
      [businessId, customerId],
    );
    return result.rows[0] ?? null;
  }

  async createOrder(
    businessId: string,
    input: OrderPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<Order> {
    try {
      const result = await executor.query<OrderRow>(
        `INSERT INTO orders (business_id, customer_id, quote_id, status, currency, subtotal, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${orderColumns}`,
        [businessId, input.customerId, input.quoteId, input.status, input.currency,
          input.subtotal, input.total],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created order");
      return mapOrder(row);
    } catch (error) {
      if (isQuoteConflict(error)) throw new QuoteConversionConflictError();
      throw error;
    }
  }

  async createItem(
    businessId: string,
    orderId: string,
    input: OrderItemPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<OrderItem> {
    const result = await executor.query<OrderItemRow>(
      `INSERT INTO order_items (
         business_id, order_id, product_id, product_name, quantity,
         pricing_type, unit_price, total_price
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${itemColumns}`,
      [businessId, orderId, input.productId, input.productName, input.quantity,
        input.pricingType, input.unitPrice, input.totalPrice],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the created order item");
    return mapItem(row);
  }

  async markQuoteConverted(
    businessId: string,
    quoteId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const result = await executor.query<{ id: string }>(
      `UPDATE quotes SET status = 'converted'
       WHERE business_id = $1 AND id = $2 AND status = 'active'
       RETURNING id`,
      [businessId, quoteId],
    );
    return result.rows[0] !== undefined;
  }

  async list(businessId: string, options: OrderListOptions): Promise<Order[]> {
    const result = await this.db.query<OrderRow>(
      `SELECT ${orderColumns} FROM orders
       WHERE business_id = $1
         AND ($2::order_status IS NULL OR status = $2)
         AND ($3::uuid IS NULL OR customer_id = $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4 OFFSET $5`,
      [businessId, options.status ?? null, options.customerId ?? null,
        options.limit, options.offset],
    );
    if (result.rows.length === 0) return [];
    const items = await this.db.query<OrderItemRow>(
      `SELECT ${itemColumns} FROM order_items
       WHERE business_id = $1 AND order_id = ANY($2::uuid[])
       ORDER BY created_at ASC, id ASC`,
      [businessId, result.rows.map((row) => row.id)],
    );
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const row of items.rows) {
      const mapped = mapItem(row);
      const current = itemsByOrder.get(mapped.orderId) ?? [];
      current.push(mapped);
      itemsByOrder.set(mapped.orderId, current);
    }
    return result.rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) ?? []));
  }

  async findById(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Order | null> {
    const result = await executor.query<OrderRow>(
      `SELECT ${orderColumns} FROM orders WHERE business_id = $1 AND id = $2`,
      [businessId, orderId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const items = await executor.query<OrderItemRow>(
      `SELECT ${itemColumns} FROM order_items
       WHERE business_id = $1 AND order_id = $2
       ORDER BY created_at ASC, id ASC`,
      [businessId, orderId],
    );
    return mapOrder(row, items.rows.map(mapItem));
  }

  async cancelPending(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Order | null> {
    const result = await executor.query<OrderRow>(
      `UPDATE orders SET status = 'cancelled', updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status = 'pending_payment'
       RETURNING ${orderColumns}`,
      [businessId, orderId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const items = await executor.query<OrderItemRow>(
      `SELECT ${itemColumns} FROM order_items
       WHERE business_id = $1 AND order_id = $2
       ORDER BY created_at ASC, id ASC`,
      [businessId, orderId],
    );
    return mapOrder(row, items.rows.map(mapItem));
  }
}
