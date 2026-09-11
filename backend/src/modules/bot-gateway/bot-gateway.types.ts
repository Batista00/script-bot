import type { JsonObject } from "../integrations/integrations.types.js";
import type { CreateCustomerInput } from "../customers/customers.types.js";
import type { DispatchFulfillmentInput, FulfillmentStatus } from "../fulfillments/fulfillments.types.js";
import type { CreateOrderInput, OrderStatus } from "../orders/orders.types.js";
import type { JobStatus } from "../jobs/jobs.types.js";
import type { PaymentStatus } from "../payments/payments.types.js";
import type { ProductType } from "../products/products.types.js";
import type { ProductInputField } from "../products/product-inputs.js";
import type { ProductDelivery } from "../products/product-delivery.js";
import type { CreateQuoteInput, QuoteStatus } from "../quotes/quotes.types.js";

export type BotResolveCustomerInput = CreateCustomerInput;
export type BotCreateQuoteInput = Omit<CreateQuoteInput, "currency"> & { currency?: string };
export type BotCreateOrderInput =
  Omit<CreateOrderInput, "fulfillmentInput"> &
  { fulfillmentInput?: Record<string, unknown> | string };
export type BotDispatchFulfillmentInput = DispatchFulfillmentInput;
export interface BotCreatePaymentInput { providerKey?: string; paymentMethodId?: string }
export interface BotPaymentMethodDto {
  paymentMethodId: string;
  type: "mercado_pago" | "bank_transfer";
  name: string;
  config: Record<string, unknown>;
}

export interface BotListQuery { limit?: string; offset?: string }
export interface BotProductListQuery extends BotListQuery {
  categoryId?: string;
  type?: ProductType;
}

export interface BotCatalogPackagesQuery {
  categoryId: string;
}

export interface BotCatalogPackageDto {
  productId: string;
  name: string;
  quantity: number;
  currency: string;
  price: number;
}

export interface BotCatalogPackagesDto {
  categoryId: string;
  packages: BotCatalogPackageDto[];
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
  deliveryConfig?: ProductDelivery | null;
  productId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  sku: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  requiredInputs: ProductInputField[];
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
  items?: import("../quotes/quote-cart.js").QuoteItem[];
  delivery?: import("../products/physical-delivery.js").PhysicalDelivery | null;
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
  fulfillmentInput?: JsonObject;
}
export interface BotOrderDto {
  delivery?: import("../products/physical-delivery.js").PhysicalDelivery | null;
  orderId: string;
  customerId: string;
  quoteId: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  total: number;
  items: BotOrderItemDto[];
}
export interface BotOrderListQuery {
  limit?: string;
  offset?: string;
  status?: OrderStatus;
}
export interface BotPaymentListQuery {
  limit?: string;
  offset?: string;
  status?: PaymentStatus;
}
export interface BotFulfillmentListQuery {
  limit?: string;
  offset?: string;
  status?: FulfillmentStatus;
}
export interface BotJobListQuery {
  limit?: string;
  offset?: string;
  status?: JobStatus;
  jobType?: string;
}
export interface BotJobDto {
  jobId: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
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
  providerOrderReference: string | null;
  status: FulfillmentStatus;
  submittedAt: string | null;
  lastStatusSyncedAt: string | null;
  completedAt: string | null;
}
