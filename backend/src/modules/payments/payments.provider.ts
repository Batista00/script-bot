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

export interface FetchProviderPaymentStatusInput {
  businessId: string;
  /** Local payment id, also used as the provider `external_reference`. */
  paymentId: string;
  providerReferenceId: string | null;
  providerPaymentId: string | null;
}

export interface ProviderPaymentStatus {
  providerPaymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
}

export interface PaymentProvider {
  readonly key: string;
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult>;
  /**
   * Optional server-to-server status lookup used to reconcile pending payments
   * (for example when a webhook never arrived). Returning `null` means there is
   * nothing to reconcile yet.
   */
  fetchStatus?(
    input: FetchProviderPaymentStatusInput,
  ): Promise<ProviderPaymentStatus | null>;
  /**
   * Validates the stored credentials without side effects. Implementations must
   * throw `PaymentProviderCredentialsInvalidError` when the provider rejects
   * them, so the panel can show an actionable message.
   */
  verifyCredentials?(input: {
    businessId: string;
    integrationId: string;
  }): Promise<void>;
}

export class PaymentProviderUnavailableError extends Error {}
export class PaymentProviderCredentialsInvalidError extends Error {}
export class PaymentProviderCurrencyNotSupportedError extends Error {}
