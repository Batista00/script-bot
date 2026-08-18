import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { DatabaseExecutor } from "../../src/core/database/database.js";
import type {
  Order,
  OrderCustomer,
  OrderItem,
  OrderItemPersistenceInput,
  OrderListOptions,
  OrderPersistenceInput,
  OrderQuoteSnapshot,
  OrdersRepository,
} from "../../src/modules/orders/orders.types.js";
import { QuoteConversionConflictError } from "../../src/modules/orders/orders.types.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";

export const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
export const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
export const missingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
export const now = "2026-08-18T12:00:00.000Z";

interface MemorySnapshot {
  quotes: OrderQuoteSnapshot[];
  customers: OrderCustomerRecord[];
  orders: Order[];
  items: OrderItem[];
}

interface OrderCustomerRecord extends OrderCustomer { businessId: string }

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryOrdersRepository implements OrdersRepository {
  quotes: OrderQuoteSnapshot[] = [];
  customers: OrderCustomerRecord[] = [];
  orders: Order[] = [];
  items: OrderItem[] = [];
  failItem = false;
  failQuoteUpdate = false;
  private snapshot: MemorySnapshot | null = null;

  addCustomer(businessId: string, status: "active" | "inactive" = "active"): OrderCustomerRecord {
    const customer = { id: randomUUID(), businessId, status };
    this.customers.push(customer);
    return customer;
  }

  addQuote(businessId: string, changes: Partial<OrderQuoteSnapshot> = {}): OrderQuoteSnapshot {
    const quote: OrderQuoteSnapshot = {
      id: randomUUID(), businessId, customerId: null, productId: randomUUID(), quantity: 5000,
      productName: "Seguidores Premium", currency: "CLP", pricingType: "unit",
      unitPrice: 3, totalPrice: 15_000, status: "active", expiresAt: null, ...changes,
    };
    this.quotes.push(quote);
    return quote;
  }

  begin(): void {
    this.snapshot = clone({
      quotes: this.quotes,
      customers: this.customers,
      orders: this.orders,
      items: this.items,
    });
  }

  commit(): void { this.snapshot = null; }

  rollback(): void {
    if (!this.snapshot) return;
    this.quotes = this.snapshot.quotes;
    this.customers = this.snapshot.customers;
    this.orders = this.snapshot.orders;
    this.items = this.snapshot.items;
    this.snapshot = null;
  }

  async findQuoteForConversion(
    businessId: string,
    quoteId: string,
    _executor: DatabaseExecutor,
  ): Promise<OrderQuoteSnapshot | null> {
    return this.quotes.find((quote) => quote.businessId === businessId && quote.id === quoteId) ?? null;
  }

  async findCustomerForConversion(
    businessId: string,
    customerId: string,
    _executor: DatabaseExecutor,
  ): Promise<OrderCustomer | null> {
    return this.customers.find((customer) =>
      customer.businessId === businessId && customer.id === customerId) ?? null;
  }

  async createOrder(
    businessId: string,
    input: OrderPersistenceInput,
    _executor: DatabaseExecutor,
  ): Promise<Order> {
    if (this.orders.some((order) => order.quoteId === input.quoteId)) {
      throw new QuoteConversionConflictError();
    }
    const order: Order = {
      id: randomUUID(), businessId, customerId: input.customerId, quoteId: input.quoteId,
      status: input.status, currency: input.currency, subtotal: input.subtotal,
      total: input.total, createdAt: now, updatedAt: now, items: [],
    };
    this.orders.push(order);
    return clone(order);
  }

  async createItem(
    businessId: string,
    orderId: string,
    input: OrderItemPersistenceInput,
    _executor: DatabaseExecutor,
  ): Promise<OrderItem> {
    if (this.failItem) throw new Error("Order item failed");
    const item: OrderItem = {
      id: randomUUID(), businessId, orderId, productId: input.productId,
      productName: input.productName, quantity: input.quantity,
      pricingType: input.pricingType, unitPrice: input.unitPrice,
      totalPrice: input.totalPrice, createdAt: now,
    };
    this.items.push(item);
    return clone(item);
  }

  async markQuoteConverted(
    businessId: string,
    quoteId: string,
    _executor: DatabaseExecutor,
  ): Promise<boolean> {
    if (this.failQuoteUpdate) throw new Error("Quote update failed");
    const quote = this.quotes.find((item) => item.businessId === businessId && item.id === quoteId);
    if (!quote || quote.status !== "active") return false;
    quote.status = "converted";
    return true;
  }

  async list(businessId: string, options: OrderListOptions): Promise<Order[]> {
    return this.orders.filter((order) => order.businessId === businessId &&
      (options.status === undefined || order.status === options.status) &&
      (options.customerId === undefined || order.customerId === options.customerId))
      .slice(options.offset, options.offset + options.limit)
      .map((order) => this.withItems(order));
  }

  async findById(businessId: string, orderId: string): Promise<Order | null> {
    const order = this.orders.find((item) => item.businessId === businessId && item.id === orderId);
    return order ? this.withItems(order) : null;
  }

  async cancelPending(businessId: string, orderId: string): Promise<Order | null> {
    const order = this.orders.find((item) => item.businessId === businessId && item.id === orderId);
    if (!order || order.status !== "pending_payment") return null;
    order.status = "cancelled";
    order.updatedAt = now;
    return this.withItems(order);
  }

  private withItems(order: Order): Order {
    return {
      ...clone(order),
      items: this.items.filter((item) =>
        item.businessId === order.businessId && item.orderId === order.id).map(clone),
    };
  }
}

class MemoryTransactionClient {
  constructor(private readonly repository: MemoryOrdersRepository) {}

  async query(command: string): Promise<{ rows: never[] }> {
    if (command === "BEGIN") this.repository.begin();
    if (command === "COMMIT") this.repository.commit();
    if (command === "ROLLBACK") this.repository.rollback();
    return { rows: [] };
  }

  release(): void {}
}

class MemoryPool {
  constructor(private readonly repository: MemoryOrdersRepository) {}
  async connect(): Promise<MemoryTransactionClient> {
    return new MemoryTransactionClient(this.repository);
  }
}

export function createOrdersService(): {
  repository: MemoryOrdersRepository;
  service: OrdersService;
} {
  const repository = new MemoryOrdersRepository();
  const pool = new MemoryPool(repository) as unknown as Pool;
  return {
    repository,
    service: new OrdersService(repository, pool, () => new Date(now)),
  };
}
