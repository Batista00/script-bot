import type { PaymentCustomer, PaymentStatus } from "./payments.types.js";

export interface CreateProviderPaymentInput {
  businessId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  customer: PaymentCustomer;
}

export interface CreateProviderPaymentResult {
  providerReferenceId?: string;
  providerPaymentId?: string;
  status: PaymentStatus;
  checkoutUrl?: string;
  expiresAt?: string;
}

export interface PaymentProvider {
  readonly key: string;
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult>;
}

export class PaymentProviderUnavailableError extends Error {}
export class PaymentProviderCurrencyNotSupportedError extends Error {}
