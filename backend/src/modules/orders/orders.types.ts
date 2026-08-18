import type { DatabaseExecutor } from "../../core/database/database.js";
import type { PricingType } from "../pricing/pricing.types.js";
import type { QuoteStatus } from "../quotes/quotes.types.js";

export const orderStatuses = [
  "pending_payment",
  "paid",
  "processing",
  "completed",
  "cancelled",
  "failed",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export interface OrderItem {
  id: string;
  businessId: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  pricingType: PricingType;
  unitPrice: number | null;
  totalPrice: number;
  createdAt: string;
}

export interface Order {
  id: string;
  businessId: string;
  customerId: string;
  quoteId: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface CreateOrderInput {
  quoteId: string;
  customerId?: string | null;
}

export interface OrderListOptions {
  limit: number;
  offset: number;
  status?: OrderStatus;
  customerId?: string;
}

export interface OrderListQuery {
  limit?: string;
  offset?: string;
  status?: OrderStatus;
  customerId?: string;
}

export interface OrderQuoteSnapshot {
  id: string;
  businessId: string;
  customerId: string | null;
  productId: string;
  quantity: number;
  productName: string;
  currency: string;
  pricingType: PricingType;
  unitPrice: number | null;
  totalPrice: number;
  status: QuoteStatus;
  expiresAt: string | null;
}

export interface OrderCustomer {
  id: string;
  status: "active" | "inactive";
}

export interface OrderPersistenceInput {
  customerId: string;
  quoteId: string;
  currency: string;
  subtotal: number;
  total: number;
  status: OrderStatus;
}

export interface OrderItemPersistenceInput {
  productId: string;
  productName: string;
  quantity: number;
  pricingType: PricingType;
  unitPrice: number | null;
  totalPrice: number;
}

export class QuoteConversionConflictError extends Error {
  constructor() {
    super("Quote was already converted");
    this.name = "QuoteConversionConflictError";
  }
}

export interface OrdersRepository {
  findQuoteForConversion(
    businessId: string,
    quoteId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderQuoteSnapshot | null>;
  findCustomerForConversion(
    businessId: string,
    customerId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderCustomer | null>;
  createOrder(
    businessId: string,
    input: OrderPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<Order>;
  createItem(
    businessId: string,
    orderId: string,
    input: OrderItemPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<OrderItem>;
  markQuoteConverted(
    businessId: string,
    quoteId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean>;
  list(businessId: string, options: OrderListOptions): Promise<Order[]>;
  findById(
    businessId: string,
    orderId: string,
    executor?: DatabaseExecutor,
  ): Promise<Order | null>;
  cancelPending(
    businessId: string,
    orderId: string,
    executor?: DatabaseExecutor,
  ): Promise<Order | null>;
}
