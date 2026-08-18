import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { DatabaseExecutor } from "../../src/core/database/database.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentResult,
  PaymentProvider,
} from "../../src/modules/payments/payments.provider.js";
import { PaymentProviderRegistry } from "../../src/modules/payments/payments.registry.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import {
  type Payment,
  PaymentApprovedUniqueError,
  PaymentIdempotencyUniqueError,
  type PaymentListOptions,
  type PaymentOrderContext,
  type PaymentPersistenceInput,
  type PaymentProviderDetails,
  PaymentProviderIdentityUniqueError,
  type PaymentsRepository,
  type PaymentStatus,
} from "../../src/modules/payments/payments.types.js";
import type { OrderStatus } from "../../src/modules/orders/orders.types.js";

export const paymentBusinessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
export const paymentBusinessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
export const paymentMissingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
export const paymentNow = "2026-08-18T12:00:00.000Z";

interface MemorySnapshot {
  payments: Payment[];
  orders: PaymentOrderContext[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakePaymentProvider implements PaymentProvider {
  readonly calls: CreateProviderPaymentInput[] = [];
  result: CreateProviderPaymentResult = {
    providerPaymentId: "provider-payment-1",
    status: "pending",
  };
  error: Error | null = null;

  constructor(readonly key = "test_provider") {}

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    this.calls.push(clone(input));
    if (this.error) throw this.error;
    return clone(this.result);
  }
}

export class MemoryPaymentsRepository implements PaymentsRepository {
  payments: Payment[] = [];
  orders: PaymentOrderContext[] = [];
  failMarkOrderPaid = false;
  private snapshot: MemorySnapshot | null = null;

  addOrder(
    businessId = paymentBusinessA,
    changes: Partial<PaymentOrderContext> = {},
  ): PaymentOrderContext {
    const order: PaymentOrderContext = {
      id: randomUUID(), businessId, status: "pending_payment", total: 15_000,
      currency: "CLP",
      customer: {
        id: randomUUID(), name: "Cliente Payment", phone: "+56911112222",
        email: "payment@example.com",
      },
      ...changes,
    };
    this.orders.push(order);
    return clone(order);
  }

  begin(): void {
    this.snapshot = clone({ payments: this.payments, orders: this.orders });
  }

  commit(): void { this.snapshot = null; }

  rollback(): void {
    if (!this.snapshot) return;
    this.payments = this.snapshot.payments;
    this.orders = this.snapshot.orders;
    this.snapshot = null;
  }

  async create(
    businessId: string,
    input: PaymentPersistenceInput,
    _executor: DatabaseExecutor,
  ): Promise<Payment> {
    if (
      input.idempotencyKey !== null &&
      this.payments.some((payment) =>
        payment.businessId === businessId && payment.idempotencyKey === input.idempotencyKey)
    ) {
      throw new PaymentIdempotencyUniqueError();
    }
    const payment: Payment = {
      id: randomUUID(), businessId, orderId: input.orderId,
      providerKey: input.providerKey, providerPaymentId: null, status: "pending",
      amount: input.amount, currency: input.currency, checkoutUrl: null,
      idempotencyKey: input.idempotencyKey, expiresAt: null, approvedAt: null,
      createdAt: paymentNow, updatedAt: paymentNow,
    };
    this.payments.push(payment);
    return clone(payment);
  }

  async findOrderForPayment(
    businessId: string,
    orderId: string,
    _executor: DatabaseExecutor,
  ): Promise<PaymentOrderContext | null> {
    const order = this.orders.find((item) =>
      item.businessId === businessId && item.id === orderId);
    return order ? clone(order) : null;
  }

  async findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string,
  ): Promise<Payment | null> {
    const payment = this.payments.find((item) =>
      item.businessId === businessId && item.idempotencyKey === idempotencyKey);
    return payment ? clone(payment) : null;
  }

  async findByProviderIdentity(
    businessId: string,
    providerKey: string,
    providerPaymentId: string,
  ): Promise<Payment | null> {
    const payment = this.payments.find((item) =>
      item.businessId === businessId && item.providerKey === providerKey &&
      item.providerPaymentId === providerPaymentId);
    return payment ? clone(payment) : null;
  }

  async lockById(businessId: string, paymentId: string): Promise<Payment | null> {
    const payment = this.payments.find((item) =>
      item.businessId === businessId && item.id === paymentId);
    return payment ? clone(payment) : null;
  }

  async findApprovedByOrder(
    businessId: string,
    orderId: string,
  ): Promise<Payment | null> {
    const payment = this.payments.find((item) =>
      item.businessId === businessId && item.orderId === orderId &&
      item.status === "approved");
    return payment ? clone(payment) : null;
  }

  async updatePendingDetails(
    businessId: string,
    paymentId: string,
    details: PaymentProviderDetails,
  ): Promise<Payment | null> {
    const payment = this.mutablePending(businessId, paymentId);
    if (!payment) return null;
    this.ensureProviderIdentityUnique(businessId, paymentId, payment.providerKey, details.providerPaymentId);
    payment.providerPaymentId = details.providerPaymentId;
    payment.checkoutUrl = details.checkoutUrl;
    payment.expiresAt = details.expiresAt;
    return clone(payment);
  }

  async transitionPending(
    businessId: string,
    paymentId: string,
    status: Exclude<PaymentStatus, "pending">,
    details: PaymentProviderDetails,
    approvedAt: string | null,
  ): Promise<Payment | null> {
    const payment = this.mutablePending(businessId, paymentId);
    if (!payment) return null;
    this.ensureProviderIdentityUnique(businessId, paymentId, payment.providerKey, details.providerPaymentId);
    if (
      status === "approved" &&
      this.payments.some((item) => item.id !== paymentId && item.businessId === businessId &&
        item.orderId === payment.orderId && item.status === "approved")
    ) {
      throw new PaymentApprovedUniqueError();
    }
    payment.status = status;
    payment.providerPaymentId = details.providerPaymentId;
    payment.checkoutUrl = details.checkoutUrl;
    payment.expiresAt = details.expiresAt;
    payment.approvedAt = approvedAt;
    return clone(payment);
  }

  async markOrderPaid(businessId: string, orderId: string): Promise<boolean> {
    if (this.failMarkOrderPaid) throw new Error("forced order update failure");
    const order = this.orders.find((item) =>
      item.businessId === businessId && item.id === orderId &&
      item.status === "pending_payment");
    if (!order) return false;
    order.status = "paid";
    return true;
  }

  async list(businessId: string, options: PaymentListOptions): Promise<Payment[]> {
    return this.payments.filter((payment) => payment.businessId === businessId &&
      (options.status === undefined || payment.status === options.status) &&
      (options.orderId === undefined || payment.orderId === options.orderId) &&
      (options.providerKey === undefined || payment.providerKey === options.providerKey))
      .slice(options.offset, options.offset + options.limit).map(clone);
  }

  async listByOrder(
    businessId: string,
    orderId: string,
    options: Pick<PaymentListOptions, "limit" | "offset">,
  ): Promise<Payment[]> {
    return this.payments.filter((payment) =>
      payment.businessId === businessId && payment.orderId === orderId)
      .slice(options.offset, options.offset + options.limit).map(clone);
  }

  async findById(businessId: string, paymentId: string): Promise<Payment | null> {
    const payment = this.payments.find((item) =>
      item.businessId === businessId && item.id === paymentId);
    return payment ? clone(payment) : null;
  }

  orderStatus(orderId: string): OrderStatus | undefined {
    return this.orders.find((order) => order.id === orderId)?.status;
  }

  private mutablePending(businessId: string, paymentId: string): Payment | undefined {
    return this.payments.find((item) =>
      item.businessId === businessId && item.id === paymentId && item.status === "pending");
  }

  private ensureProviderIdentityUnique(
    businessId: string,
    paymentId: string,
    providerKey: string,
    providerPaymentId: string | null,
  ): void {
    if (
      providerPaymentId !== null &&
      this.payments.some((item) => item.id !== paymentId && item.businessId === businessId &&
        item.providerKey === providerKey && item.providerPaymentId === providerPaymentId)
    ) {
      throw new PaymentProviderIdentityUniqueError();
    }
  }
}

class MemoryTransactionClient {
  constructor(private readonly repository: MemoryPaymentsRepository) {}
  async query(command: string): Promise<{ rows: never[] }> {
    if (command === "BEGIN") this.repository.begin();
    if (command === "COMMIT") this.repository.commit();
    if (command === "ROLLBACK") this.repository.rollback();
    return { rows: [] };
  }
  release(): void {}
}

class MemoryPool {
  constructor(private readonly repository: MemoryPaymentsRepository) {}
  async connect(): Promise<MemoryTransactionClient> {
    return new MemoryTransactionClient(this.repository);
  }
}

export function createPaymentsService(providers?: readonly PaymentProvider[]): {
  repository: MemoryPaymentsRepository;
  provider: FakePaymentProvider;
  service: PaymentsService;
} {
  const repository = new MemoryPaymentsRepository();
  const provider = new FakePaymentProvider();
  const pool = new MemoryPool(repository) as unknown as Pool;
  return {
    repository,
    provider,
    service: new PaymentsService(
      repository,
      pool,
      new PaymentProviderRegistry(providers ?? [provider]),
      () => new Date(paymentNow),
    ),
  };
}
