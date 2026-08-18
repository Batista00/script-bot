import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import {
  type CreateOrderInput,
  type Order,
  type OrderListOptions,
  type OrdersRepository,
  QuoteConversionConflictError,
} from "./orders.types.js";

function alreadyConvertedError(): AppError {
  return new AppError("Quote was already converted", 409, "QUOTE_ALREADY_CONVERTED");
}

export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly db: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(businessId: string, input: CreateOrderInput): Promise<Order> {
    return withTransaction(this.db, async (client) => {
      const quote = await this.repository.findQuoteForConversion(
        businessId,
        input.quoteId,
        client,
      );
      if (!quote) throw new AppError("Quote not available", 404, "QUOTE_NOT_AVAILABLE");
      if (quote.status === "converted") throw alreadyConvertedError();
      if (
        quote.status === "expired" ||
        (quote.expiresAt !== null && Date.parse(quote.expiresAt) <= this.now().getTime())
      ) {
        throw new AppError("Quote is expired", 409, "QUOTE_EXPIRED");
      }
      if (quote.status !== "active") {
        throw new AppError("Quote not available", 409, "QUOTE_NOT_AVAILABLE");
      }

      let customerId: string;
      if (quote.customerId !== null) {
        if (input.customerId !== undefined && input.customerId !== null &&
            input.customerId !== quote.customerId) {
          throw new AppError(
            "Quote customer cannot be replaced",
            409,
            "CUSTOMER_NOT_AVAILABLE",
          );
        }
        customerId = quote.customerId;
      } else {
        if (input.customerId === undefined || input.customerId === null) {
          throw new AppError("Customer is required", 400, "CUSTOMER_REQUIRED");
        }
        customerId = input.customerId;
      }

      const customer = await this.repository.findCustomerForConversion(
        businessId,
        customerId,
        client,
      );
      if (!customer || customer.status !== "active") {
        throw new AppError("Customer not available", 409, "CUSTOMER_NOT_AVAILABLE");
      }

      try {
        const order = await this.repository.createOrder(
          businessId,
          {
            customerId,
            quoteId: quote.id,
            status: "pending_payment",
            currency: quote.currency,
            subtotal: quote.totalPrice,
            total: quote.totalPrice,
          },
          client,
        );
        const item = await this.repository.createItem(
          businessId,
          order.id,
          {
            productId: quote.productId,
            productName: quote.productName,
            quantity: quote.quantity,
            pricingType: quote.pricingType,
            unitPrice: quote.unitPrice,
            totalPrice: quote.totalPrice,
          },
          client,
        );
        if (!(await this.repository.markQuoteConverted(businessId, quote.id, client))) {
          throw new AppError("Quote not available", 409, "QUOTE_NOT_AVAILABLE");
        }
        return { ...order, items: [item] };
      } catch (error) {
        if (error instanceof QuoteConversionConflictError) throw alreadyConvertedError();
        throw error;
      }
    });
  }

  list(businessId: string, options: OrderListOptions): Promise<Order[]> {
    return this.repository.list(businessId, options);
  }

  async getById(businessId: string, orderId: string): Promise<Order> {
    const order = await this.repository.findById(businessId, orderId);
    if (!order) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
    return order;
  }

  cancel(businessId: string, orderId: string): Promise<Order> {
    return withTransaction(this.db, async (client) => {
      const cancelled = await this.repository.cancelPending(businessId, orderId, client);
      if (cancelled) return cancelled;
      if (!(await this.repository.findById(businessId, orderId, client))) {
        throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
      }
      throw new AppError("Order cannot be cancelled", 409, "ORDER_NOT_CANCELLABLE");
    });
  }
}
