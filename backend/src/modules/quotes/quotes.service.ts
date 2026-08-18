import { AppError } from "../../core/errors/app-error.js";
import type { CustomersRepository } from "../customers/customers.types.js";
import type { PriceCalculatorService } from "../pricing/price-calculator.service.js";
import type {
  CreateQuoteInput,
  Quote,
  QuoteListOptions,
  QuotePersistenceInput,
  QuotesRepository,
} from "./quotes.types.js";

export class QuotesService {
  constructor(
    private readonly repository: QuotesRepository,
    private readonly calculator: PriceCalculatorService,
    private readonly customers: CustomersRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private effectiveQuote(quote: Quote): Quote {
    if (
      quote.status === "active" &&
      quote.expiresAt !== null &&
      Date.parse(quote.expiresAt) <= this.now().getTime()
    ) {
      return { ...quote, status: "expired" };
    }
    return quote;
  }

  private normalizeExpiration(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= this.now().getTime()) {
      throw new AppError(
        "expiresAt must be a future date",
        400,
        "INVALID_QUOTE_EXPIRATION",
      );
    }
    return new Date(timestamp).toISOString();
  }

  async create(businessId: string, input: CreateQuoteInput): Promise<Quote> {
    const customerId = input.customerId ?? null;
    if (customerId !== null && !(await this.customers.findById(businessId, customerId))) {
      throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    }
    const expiresAt = this.normalizeExpiration(input.expiresAt);
    const calculation = await this.calculator.calculate(
      businessId,
      input.productId,
      input.quantity,
      input.currency,
    );
    const values: QuotePersistenceInput = {
      customerId,
      productId: calculation.productId,
      quantity: input.quantity,
      productName: calculation.productName,
      currency: calculation.currency,
      pricingType: calculation.pricingType,
      unitPrice: calculation.unitPrice,
      totalPrice: calculation.totalPrice,
      status: "active",
      expiresAt,
    };
    return this.effectiveQuote(await this.repository.create(businessId, values));
  }

  async list(businessId: string, options: QuoteListOptions): Promise<Quote[]> {
    return (await this.repository.list(businessId, options)).map((quote) =>
      this.effectiveQuote(quote),
    );
  }

  async getById(businessId: string, quoteId: string): Promise<Quote> {
    const quote = await this.repository.findById(businessId, quoteId);
    if (!quote) throw new AppError("Quote not found", 404, "QUOTE_NOT_FOUND");
    return this.effectiveQuote(quote);
  }
}
