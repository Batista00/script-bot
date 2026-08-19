import type { DatabaseExecutor } from "../../core/database/database.js";
import type { OrderStatus } from "../orders/orders.types.js";

export const paymentStatuses = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
  "failed",
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export interface Payment {
  id: string;
  businessId: string;
  orderId: string;
  providerKey: string;
  providerReferenceId: string | null;
  providerPaymentId: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  checkoutUrl: string | null;
  idempotencyKey: string | null;
  expiresAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentInput { providerKey: string }

export interface CreatePaymentOutcome {
  payment: Payment;
  created: boolean;
}

export interface VerifiedProviderUpdate {
  businessId: string;
  paymentId: string;
  providerKey: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
}

export interface PaymentListOptions {
  limit: number;
  offset: number;
  status?: PaymentStatus;
  orderId?: string;
  providerKey?: string;
}

export interface PaymentListQuery {
  limit?: string;
  offset?: string;
  status?: PaymentStatus;
  orderId?: string;
  providerKey?: string;
}

export interface PaymentPersistenceInput {
  orderId: string;
  providerKey: string;
  amount: number;
  currency: string;
  idempotencyKey: string | null;
}

export interface PaymentCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface PaymentOrderContext {
  id: string;
  businessId: string;
  status: OrderStatus;
  total: number;
  currency: string;
  customer: PaymentCustomer;
}

export interface PaymentProviderDetails {
  providerReferenceId: string | null;
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  expiresAt: string | null;
}

export interface PaymentsRepository {
  create(
    businessId: string,
    input: PaymentPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<Payment>;
  findOrderForPayment(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<PaymentOrderContext | null>;
  findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string,
    executor?: DatabaseExecutor,
  ): Promise<Payment | null>;
  findByProviderIdentity(
    businessId: string,
    providerKey: string,
    providerPaymentId: string,
    executor?: DatabaseExecutor,
  ): Promise<Payment | null>;
  lockById(
    businessId: string,
    paymentId: string,
    executor: DatabaseExecutor,
  ): Promise<Payment | null>;
  findApprovedByOrder(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<Payment | null>;
  updatePendingDetails(
    businessId: string,
    paymentId: string,
    details: PaymentProviderDetails,
    executor: DatabaseExecutor,
  ): Promise<Payment | null>;
  transitionPending(
    businessId: string,
    paymentId: string,
    status: Exclude<PaymentStatus, "pending">,
    details: PaymentProviderDetails,
    approvedAt: string | null,
    executor: DatabaseExecutor,
  ): Promise<Payment | null>;
  markOrderPaid(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean>;
  list(businessId: string, options: PaymentListOptions): Promise<Payment[]>;
  listByOrder(
    businessId: string,
    orderId: string,
    options: Pick<PaymentListOptions, "limit" | "offset">,
  ): Promise<Payment[]>;
  findById(businessId: string, paymentId: string): Promise<Payment | null>;
}

export class PaymentIdempotencyUniqueError extends Error {}
export class PaymentProviderIdentityUniqueError extends Error {}
export class PaymentProviderReferenceUniqueError extends Error {}
export class PaymentApprovedUniqueError extends Error {}
