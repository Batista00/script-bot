import { AppError } from "../../core/errors/app-error.js";
import type { CategoriesService } from "../categories/categories.service.js";
import type { Category } from "../categories/categories.types.js";
import type { CustomersService } from "../customers/customers.service.js";
import type { Customer } from "../customers/customers.types.js";
import type { FulfillmentsService } from "../fulfillments/fulfillments.service.js";
import type { Fulfillment } from "../fulfillments/fulfillments.types.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { Order } from "../orders/orders.types.js";
import type { PaymentsService } from "../payments/payments.service.js";
import type { Payment } from "../payments/payments.types.js";
import type { PricingService } from "../pricing/pricing.service.js";
import type { ProductPrice } from "../pricing/pricing.types.js";
import type { ProductsService } from "../products/products.service.js";
import type { Product } from "../products/products.types.js";
import type { QuotesService } from "../quotes/quotes.service.js";
import type { Quote } from "../quotes/quotes.types.js";
import type {
  BotCategoryDto,
  BotCreateOrderInput,
  BotCreateQuoteInput,
  BotCustomerDto,
  BotDispatchFulfillmentInput,
  BotFulfillmentDto,
  BotOrderDto,
  BotPaymentDto,
  BotPriceDto,
  BotProductDto,
  BotProductListQuery,
  BotQuoteDto,
  BotResolveCustomerInput,
} from "./bot-gateway.types.js";

function pagination(query: { limit?: string; offset?: string }) {
  return {
    limit: query.limit === undefined ? 50 : Number(query.limit),
    offset: query.offset === undefined ? 0 : Number(query.offset),
  };
}

export class BotGatewayService {
  constructor(
    private readonly customers: CustomersService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly pricing: PricingService,
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly fulfillments: FulfillmentsService,
  ) {}

  async resolveCustomer(businessId: string, input: BotResolveCustomerInput) {
    return this.customerDto(await this.customers.resolve(businessId, input));
  }

  async listCategories(businessId: string, query: { limit?: string; offset?: string }) {
    return (await this.categories.list(businessId, {
      ...pagination(query), status: "active",
    })).filter((value) => value.status === "active").map((value) => this.categoryDto(value));
  }

  async listProducts(businessId: string, query: BotProductListQuery) {
    return (await this.products.list(businessId, {
      ...pagination(query), status: "active",
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    })).filter((value) => value.status === "active").map((value) => this.productDto(value));
  }

  async getProduct(businessId: string, productId: string) {
    const product = await this.products.getById(businessId, productId);
    if (product.status !== "active") throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    return this.productDto(product);
  }

  async listPrices(
    businessId: string,
    productId: string,
    query: { limit?: string; offset?: string },
  ) {
    await this.getProduct(businessId, productId);
    return (await this.pricing.list(businessId, productId, {
      ...pagination(query), status: "active",
    }))
      .filter((value) => value.status === "active")
      .map((value) => this.priceDto(value));
  }

  async createQuote(businessId: string, input: BotCreateQuoteInput) {
    return this.quoteDto(await this.quotes.create(businessId, input));
  }

  async createOrder(businessId: string, input: BotCreateOrderInput) {
    return this.orderDto(await this.orders.create(businessId, input));
  }

  async getOrder(businessId: string, orderId: string) {
    return this.orderDto(await this.orders.getById(businessId, orderId));
  }

  async createPayment(
    businessId: string,
    orderId: string,
    providerKey: string,
    idempotencyKey?: string,
  ) {
    const result = await this.payments.create(businessId, orderId, providerKey, idempotencyKey);
    return { payment: this.paymentDto(result.payment), created: result.created };
  }

  async getPayment(businessId: string, paymentId: string) {
    return this.paymentDto(await this.payments.getById(businessId, paymentId));
  }

  async dispatchFulfillment(
    businessId: string,
    orderId: string,
    input: BotDispatchFulfillmentInput,
  ) {
    return this.fulfillmentDto(await this.fulfillments.dispatch(businessId, orderId, input));
  }

  async listFulfillments(businessId: string, orderId: string) {
    return (await this.fulfillments.listByOrder(businessId, orderId))
      .map((value) => this.fulfillmentDto(value));
  }

  async getFulfillment(businessId: string, fulfillmentId: string) {
    return this.fulfillmentDto(await this.fulfillments.getById(businessId, fulfillmentId));
  }

  async syncFulfillment(businessId: string, fulfillmentId: string) {
    return this.fulfillmentDto(await this.fulfillments.syncStatus(businessId, fulfillmentId));
  }

  private customerDto(value: Customer): BotCustomerDto {
    return { customerId: value.id, name: value.name, phone: value.phone,
      email: value.email, status: value.status };
  }
  private categoryDto(value: Category): BotCategoryDto {
    return { categoryId: value.id, name: value.name };
  }
  private productDto(value: Product): BotProductDto {
    return {
      productId: value.id, categoryId: value.categoryId, name: value.name,
      description: value.description, type: value.type, sku: value.sku,
      minQuantity: value.minQuantity, maxQuantity: value.maxQuantity,
    };
  }
  private priceDto(value: ProductPrice): BotPriceDto {
    return {
      priceId: value.id, productId: value.productId, pricingType: value.pricingType,
      currency: value.currency, fixedPrice: value.fixedPrice, unitPrice: value.unitPrice,
      minQuantity: value.minQuantity, maxQuantity: value.maxQuantity,
    };
  }
  private quoteDto(value: Quote): BotQuoteDto {
    return {
      quoteId: value.id, customerId: value.customerId, productId: value.productId,
      productName: value.productName, quantity: value.quantity, currency: value.currency,
      unitPrice: value.unitPrice, totalPrice: value.totalPrice, status: value.status,
      expiresAt: value.expiresAt,
    };
  }
  private orderDto(value: Order): BotOrderDto {
    return {
      orderId: value.id, customerId: value.customerId, quoteId: value.quoteId,
      status: value.status, currency: value.currency, subtotal: value.subtotal,
      total: value.total,
      items: value.items.map((item) => ({
        orderItemId: item.id, productId: item.productId, productName: item.productName,
        quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice,
      })),
    };
  }
  private paymentDto(value: Payment): BotPaymentDto {
    return {
      paymentId: value.id, orderId: value.orderId, status: value.status,
      providerKey: value.providerKey, checkoutUrl: value.checkoutUrl,
      expiresAt: value.expiresAt,
    };
  }
  private fulfillmentDto(value: Fulfillment): BotFulfillmentDto {
    return {
      fulfillmentId: value.id, orderId: value.orderId, orderItemId: value.orderItemId,
      productId: value.productId, status: value.status, submittedAt: value.submittedAt,
      lastStatusSyncedAt: value.lastStatusSyncedAt, completedAt: value.completedAt,
    };
  }
}
