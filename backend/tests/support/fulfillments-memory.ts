import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { DatabaseExecutor } from "../../src/core/database/database.js";
import type { JsonObject } from "../../src/modules/integrations/integrations.types.js";
import type { OrderStatus } from "../../src/modules/orders/orders.types.js";
import {
  type DispatchContext,
  type DispatchOrderItem,
  type DispatchProviderContext,
  type Fulfillment,
  type FulfillmentListOptions,
  FulfillmentOrderItemUniqueError,
  type FulfillmentsRepository,
  type FulfillmentStatus,
  type ProviderStatusPersistence,
} from "../../src/modules/fulfillments/fulfillments.types.js";

export const fulfillmentNow = "2026-08-18T12:00:00.000Z";
export const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
export const businessB = "533b75fa-76af-4756-ac9f-e2d1ee1d11af";
export const orderA = "91619cf5-fec6-47dc-81b5-a07fbcc600d2";
export const orderB = "c60f8e43-95f0-4d3e-ab44-f0facbd0704d";
export const itemA = "4460ed59-d34e-4804-ad01-21d48d42a963";
export const itemB = "fa95d16d-307a-47eb-b148-c715663945db";
export const productA = "2434e937-20e5-4b78-a422-b397c8bcba3f";
export const integrationA = "5e7b4b23-00e9-4a1c-bcf7-f33eb5710ad8";
export const serviceA = "acdad7b8-eab5-44e8-a4d8-8ad5f9cfdd79";

function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryFulfillmentsRepository implements FulfillmentsRepository {
  readonly orders = new Map<string, OrderStatus>([[`${businessA}:${orderA}`, "paid"]]);
  readonly items = new Map<string, DispatchOrderItem>([[`${businessA}:${orderA}:${itemA}`, {
    orderItemId: itemA, productId: productA, quantity: 100,
  }]]);
  readonly providers = new Map<string, DispatchProviderContext>([[`${businessA}:${productA}`, {
    providerServiceId: serviceA,
    integrationId: integrationA,
    providerKey: "smm_raja",
    externalServiceId: "321",
    serviceType: "Default",
    providerServiceStatus: "active",
    providerMinQuantity: 10,
    providerMaxQuantity: 1000,
    integrationStatus: "active",
  }]]);
  readonly fulfillments: Fulfillment[] = [];

  async lockOrderStatus(businessId: string, orderId: string): Promise<OrderStatus | null> {
    return this.orders.get(`${businessId}:${orderId}`) ?? null;
  }

  async findOrderItem(
    businessId: string,
    orderId: string,
    orderItemId: string,
  ): Promise<DispatchOrderItem | null> {
    const value = this.items.get(`${businessId}:${orderId}:${orderItemId}`);
    return value ? clone(value) : null;
  }

  async findActiveProviderContext(
    businessId: string,
    productId: string,
  ): Promise<DispatchProviderContext | null> {
    const value = this.providers.get(`${businessId}:${productId}`);
    return value ? clone(value) : null;
  }

  async create(
    businessId: string,
    orderId: string,
    context: DispatchContext,
    inputData: JsonObject,
  ): Promise<Fulfillment> {
    if (this.fulfillments.some((value) => value.businessId === businessId &&
      value.orderItemId === context.orderItemId)) throw new FulfillmentOrderItemUniqueError();
    const fulfillment: Fulfillment = {
      id: randomUUID(), businessId, orderId,
      orderItemId: context.orderItemId, productId: context.productId,
      integrationId: context.integrationId, providerServiceId: context.providerServiceId,
      providerKey: context.providerKey, externalServiceId: context.externalServiceId,
      providerServiceType: context.serviceType, quantity: context.quantity,
      status: "pending", providerOrderId: null, providerStatusRaw: null,
      inputData: clone(inputData), providerCharge: null, providerCurrency: null,
      providerRemains: null, providerStartCount: null, submissionAttemptedAt: null,
      submittedAt: null, lastStatusSyncedAt: null, completedAt: null,
      createdAt: fulfillmentNow, updatedAt: fulfillmentNow,
    };
    this.fulfillments.push(fulfillment);
    return clone(fulfillment);
  }

  async findByOrderItem(businessId: string, orderItemId: string): Promise<Fulfillment | null> {
    return this.find((value) => value.businessId === businessId && value.orderItemId === orderItemId);
  }
  async findById(businessId: string, fulfillmentId: string): Promise<Fulfillment | null> {
    return this.find((value) => value.businessId === businessId && value.id === fulfillmentId);
  }
  async lockById(businessId: string, fulfillmentId: string): Promise<Fulfillment | null> {
    return this.findById(businessId, fulfillmentId);
  }
  async listByOrder(businessId: string, orderId: string): Promise<Fulfillment[]> {
    return this.fulfillments.filter((value) => value.businessId === businessId &&
      value.orderId === orderId).map(clone);
  }
  async list(businessId: string, options: FulfillmentListOptions): Promise<Fulfillment[]> {
    return this.fulfillments
      .filter((value) => value.businessId === businessId &&
        (options.status === undefined || value.status === options.status))
      .slice(options.offset, options.offset + options.limit)
      .map(clone);
  }

  async markSubmitting(
    businessId: string,
    fulfillmentId: string,
    attemptedAt: string,
  ): Promise<Fulfillment | null> {
    return this.update(businessId, fulfillmentId, ["pending", "failed"], {
      status: "submitting", submissionAttemptedAt: attemptedAt,
    });
  }
  async markFailed(businessId: string, fulfillmentId: string): Promise<Fulfillment | null> {
    return this.update(businessId, fulfillmentId, ["submitting"], { status: "failed" });
  }
  async markSubmissionUnknown(
    businessId: string,
    fulfillmentId: string,
  ): Promise<Fulfillment | null> {
    return this.update(businessId, fulfillmentId, ["submitting"], {
      status: "submission_unknown",
    });
  }
  async markSubmitted(
    businessId: string,
    fulfillmentId: string,
    providerOrderId: string,
    submittedAt: string,
  ): Promise<Fulfillment | null> {
    return this.update(businessId, fulfillmentId, ["submitting"], {
      status: "submitted", providerOrderId, submittedAt,
    });
  }
  async transitionOrder(
    businessId: string,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<boolean> {
    const key = `${businessId}:${orderId}`;
    if (this.orders.get(key) !== from) return false;
    this.orders.set(key, to);
    return true;
  }
  async applyProviderStatus(
    businessId: string,
    fulfillmentId: string,
    details: ProviderStatusPersistence,
  ): Promise<Fulfillment | null> {
    return this.update(businessId, fulfillmentId, undefined, {
      status: details.status,
      providerStatusRaw: details.providerStatusRaw,
      providerCharge: details.providerCharge,
      providerCurrency: details.providerCurrency,
      providerRemains: details.providerRemains,
      providerStartCount: details.providerStartCount,
      lastStatusSyncedAt: details.lastStatusSyncedAt,
      completedAt: details.completedAt,
    });
  }
  async countNotCompletedByOrder(businessId: string, orderId: string): Promise<number> {
    return this.fulfillments.filter((value) => value.businessId === businessId &&
      value.orderId === orderId && value.status !== "completed").length;
  }

  private async find(predicate: (value: Fulfillment) => boolean): Promise<Fulfillment | null> {
    const value = this.fulfillments.find(predicate);
    return value ? clone(value) : null;
  }
  private async update(
    businessId: string,
    fulfillmentId: string,
    expected: FulfillmentStatus[] | undefined,
    patch: Partial<Fulfillment>,
  ): Promise<Fulfillment | null> {
    const value = this.fulfillments.find((item) => item.businessId === businessId &&
      item.id === fulfillmentId);
    if (!value || (expected && !expected.includes(value.status))) return null;
    Object.assign(value, clone(patch), { updatedAt: fulfillmentNow });
    return clone(value);
  }
}

class MemoryClient {
  async query(): Promise<{ rows: never[] }> { return { rows: [] }; }
  release(): void {}
}

export function createFulfillmentPool(): Pool {
  return { connect: async () => new MemoryClient() } as unknown as Pool;
}
