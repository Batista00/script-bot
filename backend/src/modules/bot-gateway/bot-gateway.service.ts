import { AppError } from "../../core/errors/app-error.js";
import type { CategoriesService } from "../categories/categories.service.js";
import type { BusinessesRepository } from "../businesses/businesses.types.js";
import type { Category } from "../categories/categories.types.js";
import type { CustomersService } from "../customers/customers.service.js";
import type { Customer } from "../customers/customers.types.js";
import type { FulfillmentsService } from "../fulfillments/fulfillments.service.js";
import type { Fulfillment } from "../fulfillments/fulfillments.types.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { Order } from "../orders/orders.types.js";
import type { PaymentsService } from "../payments/payments.service.js";
import type { Payment } from "../payments/payments.types.js";
import type { PaymentMethodsService } from "../payment-methods/payment-methods.service.js";
import type { PricingService } from "../pricing/pricing.service.js";
import type { ProductPrice } from "../pricing/pricing.types.js";
import type { ProductsService } from "../products/products.service.js";
import type { Product } from "../products/products.types.js";
import type { QuotesService } from "../quotes/quotes.service.js";
import type { Quote } from "../quotes/quotes.types.js";
import type {
  BotCatalogPackagesDto,
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
    private readonly paymentMethods?: PaymentMethodsService,
    private readonly businesses?: BusinessesRepository,
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

  async listCatalogPackages(
    businessId: string,
    categoryId: string,
  ): Promise<BotCatalogPackagesDto> {
    const products = await this.listProducts(businessId, {
      categoryId,
      type: "service",
      limit: "100",
      offset: "0",
    });

    const packages = [];

    for (const product of products) {
      if (
        product.minQuantity === null ||
        product.maxQuantity === null ||
        product.minQuantity !== product.maxQuantity
      ) {
        continue;
      }

      const quantity = product.minQuantity;
      const prices = await this.listPrices(
        businessId,
        product.productId,
        { limit: "100", offset: "0" },
      );
      const applicable = prices.find((price) =>
        (price.minQuantity === null || price.minQuantity <= quantity) &&
        (price.maxQuantity === null || price.maxQuantity >= quantity)
      );

      if (!applicable) continue;

      let price: number | null = null;

      if (
        applicable.pricingType === "fixed" &&
        applicable.fixedPrice !== null
      ) {
        price = applicable.fixedPrice;
      }

      if (
        applicable.pricingType === "unit" &&
        applicable.unitPrice !== null
      ) {
        const total = BigInt(applicable.unitPrice) * BigInt(quantity);
        if (total <= BigInt(Number.MAX_SAFE_INTEGER)) {
          price = Number(total);
        }
      }

      if (price === null) continue;

      packages.push({
        productId: product.productId,
        name: product.name,
        quantity,
        currency: applicable.currency,
        price,
      });
    }

    packages.sort((a, b) => a.quantity - b.quantity);

    return { categoryId, packages };
  }

  async getProduct(businessId: string, productId: string) {
    const product = await this.products.getById(businessId, productId);
    if (product.status !== "active") throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    return this.productDto(product);
  }
  async cancelUnpaidOrder(businessId:string,orderId:string) {
    return this.orderDto(await this.orders.cancel(businessId,orderId));
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

  async createQuote(businessId: string, input: BotCreateQuoteInput,manualShipping?:import("../products/physical-delivery.js").ManualShippingQuote) {
    let currency = input.currency;
    if (this.businesses) {
      const business = await this.businesses.findById(businessId);
      if (!business) throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
      if (currency !== undefined && currency.trim().toUpperCase() !== business.currency) {
        throw new AppError("Quote currency must match the business currency", 409, "BUSINESS_CURRENCY_MISMATCH");
      }
      currency = business.currency;
    }
    if (!currency) throw new AppError("Quote currency is required", 400, "INVALID_CURRENCY");
    return this.quoteDto(await this.quotes.create(businessId, { ...input, currency },manualShipping));
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
    input: string | { providerKey?: string; paymentMethodId?: string },
    idempotencyKey?: string,
  ) {
    const result = await this.payments.create(
      businessId, orderId, typeof input === "string" ? input : input, idempotencyKey,
    );
    return { payment: this.paymentDto(result.payment), created: result.created };
  }

  async listPaymentMethods(businessId: string) {
    if (!this.paymentMethods) return [];
    return (await this.paymentMethods.list(businessId, "active")).map((method) => ({
      paymentMethodId: method.id, type: method.type, name: method.name, config: method.config,
    }));
  }

  async getPayment(businessId: string, paymentId: string) {
    return this.paymentDto(await this.payments.getById(businessId, paymentId));
  }

  async dispatchFulfillment(
    businessId: string,
    orderId: string,
    input: BotDispatchFulfillmentInput,
    expectedProviderServiceId?: string,
  ) {
    return this.fulfillmentDto(await this.fulfillments.dispatch(businessId, orderId, input, expectedProviderServiceId));
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
      requiredInputs: value.requiredInputs ?? [],
      deliveryConfig: value.deliveryConfig ?? null,
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
      ...(value.items?{items:value.items}:{}),
      ...(value.delivery?{delivery:value.delivery}:{}),
      quoteId: value.id, customerId: value.customerId, productId: value.productId,
      productName: value.productName, quantity: value.quantity, currency: value.currency,
      unitPrice: value.unitPrice, totalPrice: value.totalPrice, status: value.status,
      expiresAt: value.expiresAt,
    };
  }
  private orderDto(value: Order): BotOrderDto {
    return {
      ...(value.delivery?{delivery:value.delivery}:{}),
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
      productId: value.productId, providerOrderReference: value.providerOrderId,
      status: value.status, submittedAt: value.submittedAt,
      lastStatusSyncedAt: value.lastStatusSyncedAt, completedAt: value.completedAt,
    };
  }
}
