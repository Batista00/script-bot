import type { JsonObject } from "../integrations/integrations.types.js";
import type { FulfillmentStatus } from "./fulfillments.types.js";

export interface CreateProviderOrderInput {
  businessId: string;
  integrationId: string;
  externalServiceId: string;
  serviceType: string | null;
  quantity: number;
  fulfillmentInput: JsonObject;
}

export interface CreateProviderOrderResult { providerOrderId: string }

export interface GetProviderOrderStatusInput {
  businessId: string;
  integrationId: string;
  providerOrderId: string;
}

export interface ProviderOrderStatusResult {
  providerOrderId: string;
  providerStatusRaw: string;
  status: Extract<
    FulfillmentStatus,
    "submitted" | "in_progress" | "completed" | "partial" | "cancelled"
  > | null;
  charge: string | null;
  currency: string | null;
  remains: number | null;
  startCount: number | null;
}

export interface ProviderFulfillmentAdapter {
  readonly key: string;
  createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult>;
  getOrderStatus(input: GetProviderOrderStatusInput): Promise<ProviderOrderStatusResult>;
}

export class ProviderFulfillmentUnavailableError extends Error {}
export class ProviderFulfillmentInputError extends Error {}
export class ProviderFulfillmentServiceTypeError extends Error {}
export class ProviderOrderRejectedError extends Error {}
export class ProviderSubmissionUnknownError extends Error {}
export class ProviderFulfillmentTemporarilyUnavailableError extends Error {}
export class ProviderFulfillmentResponseInvalidError extends Error {}
