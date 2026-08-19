import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import type { IntegrationStatus } from "../integrations/integrations.types.js";
import type { OrderStatus } from "../orders/orders.types.js";
import type { ProviderServiceStatus } from "../provider-catalog/provider-catalog.types.js";

export const fulfillmentStatuses = [
  "pending", "submitting", "submitted", "in_progress", "completed",
  "partial", "cancelled", "failed", "submission_unknown",
] as const;
export type FulfillmentStatus = (typeof fulfillmentStatuses)[number];

export interface Fulfillment {
  id: string;
  businessId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  integrationId: string;
  providerServiceId: string;
  providerKey: string;
  externalServiceId: string;
  providerServiceType: string | null;
  quantity: number;
  status: FulfillmentStatus;
  providerOrderId: string | null;
  providerStatusRaw: string | null;
  inputData: JsonObject;
  providerCharge: string | null;
  providerCurrency: string | null;
  providerRemains: number | null;
  providerStartCount: number | null;
  submissionAttemptedAt: string | null;
  submittedAt: string | null;
  lastStatusSyncedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchFulfillmentInput {
  orderItemId: string;
  input: JsonObject;
}

export interface DispatchOrderItem {
  orderItemId: string;
  productId: string;
  quantity: number;
}

export interface DispatchProviderContext {
  providerServiceId: string;
  integrationId: string;
  providerKey: string;
  externalServiceId: string;
  serviceType: string | null;
  providerServiceStatus: ProviderServiceStatus;
  providerMinQuantity: number | null;
  providerMaxQuantity: number | null;
  integrationStatus: IntegrationStatus;
}

export interface DispatchContext extends DispatchOrderItem, DispatchProviderContext {
  orderStatus: OrderStatus;
}

export interface ProviderStatusPersistence {
  providerStatusRaw: string;
  status: FulfillmentStatus;
  providerCharge: string | null;
  providerCurrency: string | null;
  providerRemains: number | null;
  providerStartCount: number | null;
  lastStatusSyncedAt: string;
  completedAt: string | null;
}

export class FulfillmentOrderItemUniqueError extends Error {}
export class FulfillmentProviderOrderUniqueError extends Error {}

export interface FulfillmentsRepository {
  lockOrderStatus(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderStatus | null>;
  findOrderItem(
    businessId: string,
    orderId: string,
    orderItemId: string,
    executor: DatabaseExecutor,
  ): Promise<DispatchOrderItem | null>;
  findActiveProviderContext(
    businessId: string,
    productId: string,
    executor: DatabaseExecutor,
  ): Promise<DispatchProviderContext | null>;
  create(
    businessId: string,
    orderId: string,
    context: DispatchContext,
    inputData: JsonObject,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment>;
  findByOrderItem(businessId: string, orderItemId: string): Promise<Fulfillment | null>;
  findById(businessId: string, fulfillmentId: string): Promise<Fulfillment | null>;
  lockById(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  listByOrder(businessId: string, orderId: string): Promise<Fulfillment[]>;
  markSubmitting(
    businessId: string,
    fulfillmentId: string,
    attemptedAt: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  markFailed(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  markSubmissionUnknown(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  markSubmitted(
    businessId: string,
    fulfillmentId: string,
    providerOrderId: string,
    submittedAt: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  transitionOrder(
    businessId: string,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    executor: DatabaseExecutor,
  ): Promise<boolean>;
  applyProviderStatus(
    businessId: string,
    fulfillmentId: string,
    details: ProviderStatusPersistence,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null>;
  countNotCompletedByOrder(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<number>;
}
