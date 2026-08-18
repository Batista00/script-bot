import type { PricingType } from "../pricing/pricing.types.js";

export const quoteStatuses = ["active", "expired", "converted", "cancelled"] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];

export interface Quote {
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
  createdAt: string;
}

export interface CreateQuoteInput {
  productId: string;
  quantity: number;
  currency: string;
  customerId?: string | null;
  expiresAt?: string | null;
}

export interface QuotePersistenceInput {
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

export interface QuoteListOptions {
  limit: number;
  offset: number;
  customerId?: string;
  productId?: string;
}

export interface QuoteListQuery {
  limit?: string;
  offset?: string;
  customerId?: string;
  productId?: string;
}

export interface QuotesRepository {
  create(businessId: string, input: QuotePersistenceInput): Promise<Quote>;
  list(businessId: string, options: QuoteListOptions): Promise<Quote[]>;
  findById(businessId: string, quoteId: string): Promise<Quote | null>;
}
