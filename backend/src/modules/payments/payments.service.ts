import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import {
  type CreateProviderPaymentResult,
  PaymentProviderCurrencyNotSupportedError,
  PaymentProviderUnavailableError,
} from "./payments.provider.js";
import { normalizeProviderKey, PaymentProviderRegistry } from "./payments.registry.js";
import {
  type CreatePaymentOutcome,
  type Payment,
  PaymentApprovedUniqueError,
  PaymentIdempotencyUniqueError,
  type PaymentListOptions,
  PaymentProviderIdentityUniqueError,
  PaymentProviderReferenceUniqueError,
  type PaymentsRepository,
  type PaymentStatus,
  paymentStatuses,
  type VerifiedProviderUpdate,
} from "./payments.types.js";

function normalizeIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new AppError("Invalid Idempotency-Key", 400, "INVALID_REQUEST");
  }
  return normalized;
}

function providerNotAvailableError(): AppError {
  return new AppError(
    "Payment provider not available",
    503,
    "PAYMENT_PROVIDER_NOT_AVAILABLE",
  );
}

function invalidTransitionError(): AppError {
  return new AppError("Invalid payment transition", 409, "PAYMENT_INVALID_TRANSITION");
}

interface NormalizedProviderResult {
  providerReferenceId: string | null;
  providerPaymentId: string | null;
  status: PaymentStatus;
  checkoutUrl: string | null;
  expiresAt: string | null;
}

function normalizeProviderIdentifier(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw new Error(`Payment provider returned an invalid ${label}`);
  }
  return normalized;
}

function normalizeProviderResult(result: CreateProviderPaymentResult): NormalizedProviderResult {
  const providerReferenceId = normalizeProviderIdentifier(
    result.providerReferenceId,
    "reference id",
  );
  const providerPaymentId = normalizeProviderIdentifier(result.providerPaymentId, "payment id");
  if (!paymentStatuses.includes(result.status)) {
    throw new Error("Payment provider returned an invalid status");
  }
  if (result.status === "approved" && providerPaymentId === null) {
    throw new Error("Approved provider result requires a payment id");
  }
  let checkoutUrl: string | null = null;
  if (result.checkoutUrl !== undefined) {
    checkoutUrl = result.checkoutUrl.trim();
    if (checkoutUrl.length === 0 || checkoutUrl.length > 2048) {
      throw new Error("Payment provider returned an invalid checkout URL");
    }
    const parsedUrl = new URL(checkoutUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("Payment provider returned an invalid checkout URL");
    }
  }
  let expiresAt: string | null = null;
  if (result.expiresAt !== undefined) {
    const parsed = new Date(result.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Payment provider returned an invalid expiration");
    }
    expiresAt = parsed.toISOString();
  }
  return {
    providerReferenceId,
    providerPaymentId,
    status: result.status,
    checkoutUrl,
    expiresAt,
  };
}

export class PaymentsService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly db: Pool,
    private readonly providers: PaymentProviderRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    businessId: string,
    orderId: string,
    providerKeyInput: string,
    idempotencyKeyInput?: string,
  ): Promise<CreatePaymentOutcome> {
    let providerKey: string;
    try {
      providerKey = normalizeProviderKey(providerKeyInput);
    } catch {
      throw new AppError("Invalid payment provider key", 400, "INVALID_REQUEST");
    }
    const provider = this.providers.resolve(providerKey);
    if (!provider) throw providerNotAvailableError();
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);

    let local: { payment: Payment; customer: Parameters<typeof provider.createPayment>[0]["customer"] };
    try {
      const result = await withTransaction(this.db, async (client) => {
        if (idempotencyKey !== null) {
          const existing = await this.repository.findByIdempotencyKey(
            businessId,
            idempotencyKey,
            client,
          );
          if (existing) return { existing } as const;
        }
        const order = await this.repository.findOrderForPayment(businessId, orderId, client);
        if (!order) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
        if (order.status !== "pending_payment") {
          throw new AppError("Order is not payable", 409, "ORDER_NOT_PAYABLE");
        }
        const payment = await this.repository.create(
          businessId,
          {
            orderId: order.id,
            providerKey,
            amount: order.total,
            currency: order.currency,
            idempotencyKey,
          },
          client,
        );
        return { payment, customer: order.customer } as const;
      });
      if ("existing" in result) return this.resolveIdempotent(result.existing, orderId, providerKey);
      local = result;
    } catch (error) {
      if (!(error instanceof PaymentIdempotencyUniqueError) || idempotencyKey === null) throw error;
      const existing = await this.repository.findByIdempotencyKey(businessId, idempotencyKey);
      if (!existing) throw error;
      return this.resolveIdempotent(existing, orderId, providerKey);
    }

    let result: NormalizedProviderResult;
    try {
      const rawResult = await provider.createPayment({
        businessId,
        paymentId: local.payment.id,
        orderId: local.payment.orderId,
        amount: local.payment.amount,
        currency: local.payment.currency,
        customer: local.customer,
      });
      result = normalizeProviderResult(rawResult);
    } catch (error) {
      const payment = await this.transitionPayment(
        businessId,
        local.payment.id,
        "failed",
        null,
        null,
        null,
        null,
      );
      if (error instanceof PaymentProviderUnavailableError) {
        throw providerNotAvailableError();
      }
      if (error instanceof PaymentProviderCurrencyNotSupportedError) {
        throw new AppError(
          "Payment provider does not support this currency",
          409,
          "PAYMENT_PROVIDER_CURRENCY_NOT_SUPPORTED",
        );
      }
      if (error instanceof AppError) throw error;
      return { payment, created: true };
    }

    const payment = result.status === "pending"
      ? await this.storePendingResult(businessId, local.payment.id, result)
      : await this.transitionPayment(
          businessId,
          local.payment.id,
          result.status,
          result.providerReferenceId,
          result.providerPaymentId,
          result.checkoutUrl,
          result.expiresAt,
        );
    return { payment, created: true };
  }

  async applyProviderUpdate(
    businessId: string,
    providerKeyInput: string,
    providerPaymentIdInput: string,
    providerStatus: PaymentStatus,
  ): Promise<Payment> {
    let providerKey: string;
    try {
      providerKey = normalizeProviderKey(providerKeyInput);
    } catch {
      throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
    }
    const providerPaymentId = providerPaymentIdInput.trim();
    const payment = await this.repository.findByProviderIdentity(
      businessId,
      providerKey,
      providerPaymentId,
    );
    if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
    return this.transitionPayment(
      businessId,
      payment.id,
      providerStatus,
      payment.providerReferenceId,
      providerPaymentId,
      payment.checkoutUrl,
      payment.expiresAt,
    );
  }

  async applyVerifiedProviderUpdate(input: VerifiedProviderUpdate): Promise<Payment> {
    let providerKey: string;
    try {
      providerKey = normalizeProviderKey(input.providerKey);
    } catch {
      throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
    }
    const providerPaymentId = normalizeProviderIdentifier(
      input.providerPaymentId,
      "payment id",
    );
    if (providerPaymentId === null) throw invalidTransitionError();
    const verification = {
      providerKey,
      amount: input.amount,
      currency: input.currency,
    };
    if (input.status === "pending") {
      return this.bindVerifiedPending(
        input.businessId,
        input.paymentId,
        providerPaymentId,
        verification,
      );
    }
    return this.transitionPayment(
      input.businessId,
      input.paymentId,
      input.status,
      null,
      providerPaymentId,
      null,
      null,
      verification,
    );
  }

  list(businessId: string, options: PaymentListOptions): Promise<Payment[]> {
    let providerKey: string | undefined;
    try {
      providerKey = options.providerKey === undefined
        ? undefined
        : normalizeProviderKey(options.providerKey);
    } catch {
      throw new AppError("Invalid payment provider key", 400, "INVALID_REQUEST");
    }
    return this.repository.list(businessId, {
      ...options,
      ...(providerKey === undefined ? {} : { providerKey }),
    });
  }

  listByOrder(
    businessId: string,
    orderId: string,
    options: Pick<PaymentListOptions, "limit" | "offset">,
  ): Promise<Payment[]> {
    return this.repository.listByOrder(businessId, orderId, options);
  }

  async getById(businessId: string, paymentId: string): Promise<Payment> {
    const payment = await this.repository.findById(businessId, paymentId);
    if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
    return payment;
  }

  private resolveIdempotent(
    payment: Payment,
    orderId: string,
    providerKey: string,
  ): CreatePaymentOutcome {
    if (payment.orderId !== orderId || payment.providerKey !== providerKey) {
      throw new AppError(
        "Idempotency-Key was already used for another payment",
        409,
        "PAYMENT_IDEMPOTENCY_CONFLICT",
      );
    }
    return { payment, created: false };
  }

  private storePendingResult(
    businessId: string,
    paymentId: string,
    result: NormalizedProviderResult,
  ): Promise<Payment> {
    return withTransaction(this.db, async (client) => {
      const payment = await this.repository.lockById(businessId, paymentId, client);
      if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
      if (payment.status !== "pending") throw invalidTransitionError();
      try {
        const updated = await this.repository.updatePendingDetails(
          businessId,
          payment.id,
          {
            providerReferenceId: result.providerReferenceId,
            providerPaymentId: result.providerPaymentId,
            checkoutUrl: result.checkoutUrl,
            expiresAt: result.expiresAt,
          },
          client,
        );
        if (!updated) throw invalidTransitionError();
        return updated;
      } catch (error) {
        if (
          error instanceof PaymentProviderIdentityUniqueError ||
          error instanceof PaymentProviderReferenceUniqueError
        ) {
          throw invalidTransitionError();
        }
        throw error;
      }
    });
  }

  private bindVerifiedPending(
    businessId: string,
    paymentId: string,
    providerPaymentId: string,
    verification: { providerKey: string; amount: number; currency: string },
  ): Promise<Payment> {
    return withTransaction(this.db, async (client) => {
      const payment = await this.repository.lockById(businessId, paymentId, client);
      if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
      this.verifyProviderPayment(payment, providerPaymentId, verification);
      if (payment.status !== "pending") throw invalidTransitionError();
      try {
        const updated = await this.repository.updatePendingDetails(
          businessId,
          payment.id,
          {
            providerReferenceId: payment.providerReferenceId,
            providerPaymentId,
            checkoutUrl: payment.checkoutUrl,
            expiresAt: payment.expiresAt,
          },
          client,
        );
        if (!updated) throw invalidTransitionError();
        return updated;
      } catch (error) {
        if (error instanceof PaymentProviderIdentityUniqueError) {
          throw invalidTransitionError();
        }
        throw error;
      }
    });
  }

  private transitionPayment(
    businessId: string,
    paymentId: string,
    targetStatus: PaymentStatus,
    providerReferenceId: string | null,
    providerPaymentId: string | null,
    checkoutUrl: string | null,
    expiresAt: string | null,
    verification?: { providerKey: string; amount: number; currency: string },
  ): Promise<Payment> {
    return withTransaction(this.db, async (client) => {
      const payment = await this.repository.lockById(businessId, paymentId, client);
      if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
      if (verification !== undefined && providerPaymentId !== null) {
        this.verifyProviderPayment(payment, providerPaymentId, verification);
      }
      if (
        payment.providerPaymentId !== null &&
        providerPaymentId !== null &&
        payment.providerPaymentId !== providerPaymentId
      ) {
        throw invalidTransitionError();
      }
      if (payment.status === targetStatus) return payment;
      if (payment.status !== "pending" || targetStatus === "pending") {
        throw invalidTransitionError();
      }

      const details = {
        providerReferenceId: providerReferenceId ?? payment.providerReferenceId,
        providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
        checkoutUrl: checkoutUrl ?? payment.checkoutUrl,
        expiresAt: expiresAt ?? payment.expiresAt,
      };
      const approvedAt = targetStatus === "approved" ? this.now().toISOString() : null;

      try {
        if (targetStatus === "approved") {
          const order = await this.repository.findOrderForPayment(
            businessId,
            payment.orderId,
            client,
          );
          if (!order) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
          const alreadyApproved = await this.repository.findApprovedByOrder(
            businessId,
            payment.orderId,
            client,
          );
          if (alreadyApproved || order.status === "paid") {
            throw new AppError("Order already has an approved payment", 409, "PAYMENT_ALREADY_APPROVED");
          }
          if (
            order.status !== "pending_payment" ||
            order.total !== payment.amount ||
            order.currency !== payment.currency
          ) {
            throw new AppError("Order is not payable", 409, "ORDER_NOT_PAYABLE");
          }
          const updated = await this.repository.transitionPending(
            businessId,
            payment.id,
            targetStatus,
            details,
            approvedAt,
            client,
          );
          if (!updated) throw invalidTransitionError();
          if (!(await this.repository.markOrderPaid(businessId, order.id, client))) {
            throw new AppError("Order is not payable", 409, "ORDER_NOT_PAYABLE");
          }
          return updated;
        }

        const updated = await this.repository.transitionPending(
          businessId,
          payment.id,
          targetStatus,
          details,
          null,
          client,
        );
        if (!updated) throw invalidTransitionError();
        return updated;
      } catch (error) {
        if (error instanceof PaymentApprovedUniqueError) {
          throw new AppError("Order already has an approved payment", 409, "PAYMENT_ALREADY_APPROVED");
        }
        if (
          error instanceof PaymentProviderIdentityUniqueError ||
          error instanceof PaymentProviderReferenceUniqueError
        ) {
          throw invalidTransitionError();
        }
        throw error;
      }
    });
  }

  private verifyProviderPayment(
    payment: Payment,
    providerPaymentId: string,
    verification: { providerKey: string; amount: number; currency: string },
  ): void {
    if (payment.providerKey !== verification.providerKey) {
      throw new AppError("Payment provider does not match", 409, "PAYMENT_PROVIDER_MISMATCH");
    }
    if (payment.amount !== verification.amount) {
      throw new AppError("Payment amount does not match", 409, "PAYMENT_AMOUNT_MISMATCH");
    }
    if (payment.currency !== verification.currency) {
      throw new AppError("Payment currency does not match", 409, "PAYMENT_CURRENCY_MISMATCH");
    }
    if (
      payment.providerPaymentId !== null &&
      payment.providerPaymentId !== providerPaymentId
    ) {
      throw invalidTransitionError();
    }
  }
}
