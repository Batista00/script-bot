import type { CreateProviderPaymentInput, CreateProviderPaymentResult, PaymentProvider } from "./payments.provider.js";

export class BankTransferPaymentProvider implements PaymentProvider {
  readonly key = "bank_transfer";
  async createPayment(_input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    return { status: "pending" };
  }
}
