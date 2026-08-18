import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { CreateProviderPaymentResult } from "./payments.provider.js";
import { normalizeProviderKey, PaymentProviderRegistry } from "./payments.registry.js";
import {
  type CreatePaymentOutcome,
  type Payment,
  PaymentApprovedUniqueError,
  PaymentIdempotencyUniqueError,
  type PaymentListOptions,
  PaymentProviderIdentityUniqueError,
  type PaymentsRepository,
  type PaymentStatus,
  paymentStatuses,
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

function normalizeProviderResult(result: CreateProviderPaymentResult): Required<CreateProviderPaymentResult> {
  const providerPaymentId = result.providerPaymentId.trim();
  if (providerPaymentId.length === 0 || providerPaymentId.length > 255) {
    throw new Error("Payment provider returned an invalid payment id");
  }
  if (!paymentStatuses.includes(result.status)) {
    throw new Error("Payment provider returned an invalid status");
  }
  let checkoutUrl = "";
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
  let expiresAt = "";
  if (result.expiresAt !== undefined) {
    const parsed = new Date(result.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Payment provider returned an invalid expiration");
    }
    expiresAt = parsed.toISOString();
  }
  return { providerPaymentId, status: result.status, checkoutUrl, expiresAt };
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

    try {
      const rawResult = await provider.createPayment({
        paymentId: local.payment.id,
        orderId: local.payment.orderId,
        amount: local.payment.amount,
        currency: local.payment.currency,
        customer: local.customer,
      });
      const result = normalizeProviderResult(rawResult);
      const payment = result.status === "pending"
        ? await this.storePendingResult(businessId, local.payment.id, result)
        : await this.transitionPayment(
            businessId,
            local.payment.id,
            result.status,
            result.providerPaymentId,
            result.checkoutUrl || null,
            result.expiresAt || null,
          );
      return { payment, created: true };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const payment = await this.transitionPayment(
        businessId,
        local.payment.id,
        "failed",
        null,
        null,
        null,
      );
      return { payment, created: true };
    }
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
      providerPaymentId,
      payment.checkoutUrl,
      payment.expiresAt,
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
    result: Required<CreateProviderPaymentResult>,
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
            providerPaymentId: result.providerPaymentId,
            checkoutUrl: result.checkoutUrl || null,
            expiresAt: result.expiresAt || null,
          },
          client,
        );
        if (!updated) throw invalidTransitionError();
        return updated;
      } catch (error) {
        if (error instanceof PaymentProviderIdentityUniqueError) {
          throw new AppError("Provider payment already exists", 409, "PAYMENT_INVALID_TRANSITION");
        }
        throw error;
      }
    });
  }

  private transitionPayment(
    businessId: string,
    paymentId: string,
    targetStatus: PaymentStatus,
    providerPaymentId: string | null,
    checkoutUrl: string | null,
    expiresAt: string | null,
  ): Promise<Payment> {
    return withTransaction(this.db, async (client) => {
      const payment = await this.repository.lockById(businessId, paymentId, client);
      if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
      if (payment.status === targetStatus) return payment;
      if (payment.status !== "pending" || targetStatus === "pending") {
        throw invalidTransitionError();
      }
      if (
        payment.providerPaymentId !== null &&
        providerPaymentId !== null &&
        payment.providerPaymentId !== providerPaymentId
      ) {
        throw invalidTransitionError();
      }

      const details = {
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
        if (error instanceof PaymentProviderIdentityUniqueError) {
          throw invalidTransitionError();
        }
        throw error;
      }
    });
  }
}
