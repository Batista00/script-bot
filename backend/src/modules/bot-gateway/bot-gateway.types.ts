import type { CreateCustomerInput } from "../customers/customers.types.js";
import type { DispatchFulfillmentInput, FulfillmentStatus } from "../fulfillments/fulfillments.types.js";
import type { CreateOrderInput, OrderStatus } from "../orders/orders.types.js";
import type { PaymentStatus } from "../payments/payments.types.js";
import type { ProductType } from "../products/products.types.js";
import type { CreateQuoteInput, QuoteStatus } from "../quotes/quotes.types.js";

export type BotResolveCustomerInput = CreateCustomerInput;
export type BotCreateQuoteInput = CreateQuoteInput;
export type BotCreateOrderInput = CreateOrderInput;
export type BotDispatchFulfillmentInput = DispatchFulfillmentInput;
export interface BotCreatePaymentInput { providerKey: string }

export interface BotListQuery { limit?: string; offset?: string }
export interface BotProductListQuery extends BotListQuery {
  categoryId?: string;
  type?: ProductType;
}
export interface BotIdempotencyHeaders { "idempotency-key"?: string }

export interface BotCustomerDto {
  customerId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive";
}
export interface BotCategoryDto { categoryId: string; name: string }
export interface BotProductDto {
  productId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  sku: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
}
export interface BotPriceDto {
  priceId: string;
  productId: string;
  pricingType: "fixed" | "unit";
  currency: string;
  fixedPrice: number | null;
  unitPrice: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
}
export interface BotQuoteDto {
  quoteId: string;
  customerId: string | null;
  productId: string;
  productName: string;
  quantity: number;
  currency: string;
  unitPrice: number | null;
  totalPrice: number;
  status: QuoteStatus;
  expiresAt: string | null;
}
export interface BotOrderItemDto {
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
}
export interface BotOrderDto {
  orderId: string;
  customerId: string;
  quoteId: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  total: number;
  items: BotOrderItemDto[];
}
export interface BotPaymentDto {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  providerKey: string;
  checkoutUrl: string | null;
  expiresAt: string | null;
}
export interface BotFulfillmentDto {
  fulfillmentId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  status: FulfillmentStatus;
  submittedAt: string | null;
  lastStatusSyncedAt: string | null;
  completedAt: string | null;
}
