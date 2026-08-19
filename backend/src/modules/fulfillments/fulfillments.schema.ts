import type { FastifySchema } from "fastify";

const errorResponse = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;
const uuid = { type: "string", format: "uuid" } as const;
const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;
const nullableDate = { type: ["string", "null"], format: "date-time" } as const;
const fulfillmentResponse = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "orderId", "orderItemId", "productId", "integrationId",
    "providerServiceId", "providerKey", "externalServiceId", "providerServiceType",
    "quantity", "status", "providerOrderId", "providerStatusRaw", "inputData",
    "providerCharge", "providerCurrency", "providerRemains", "providerStartCount",
    "submissionAttemptedAt", "submittedAt", "lastStatusSyncedAt", "completedAt",
    "createdAt", "updatedAt",
  ],
  properties: {
    id: uuid, businessId: uuid, orderId: uuid, orderItemId: uuid, productId: uuid,
    integrationId: uuid, providerServiceId: uuid,
    providerKey: { type: "string" }, externalServiceId: { type: "string" },
    providerServiceType: nullableString, quantity: { type: "integer" },
    status: {
      type: "string",
      enum: [
        "pending", "submitting", "submitted", "in_progress", "completed",
        "partial", "cancelled", "failed", "submission_unknown",
      ],
    },
    providerOrderId: nullableString, providerStatusRaw: nullableString,
    inputData: { type: "object", additionalProperties: true },
    providerCharge: nullableString, providerCurrency: nullableString,
    providerRemains: nullableInteger, providerStartCount: nullableInteger,
    submissionAttemptedAt: nullableDate, submittedAt: nullableDate,
    lastStatusSyncedAt: nullableDate, completedAt: nullableDate,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const orderParams = {
  type: "object", additionalProperties: false, required: ["businessId", "orderId"],
  properties: { businessId: uuid, orderId: uuid },
} as const;
const fulfillmentParams = {
  type: "object", additionalProperties: false,
  required: ["businessId", "fulfillmentId"],
  properties: { businessId: uuid, fulfillmentId: uuid },
} as const;
const commonErrors = {
  400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse,
  409: errorResponse, 502: errorResponse, 503: errorResponse,
} as const;

export const dispatchFulfillmentSchema = {
  params: orderParams,
  body: {
    type: "object", additionalProperties: false, required: ["orderItemId", "input"],
    properties: {
      orderItemId: uuid,
      input: { type: "object", additionalProperties: true, maxProperties: 50 },
    },
  },
  response: { 201: fulfillmentResponse, ...commonErrors },
} satisfies FastifySchema;

export const listFulfillmentsSchema = {
  params: orderParams,
  response: { 200: { type: "array", items: fulfillmentResponse }, ...commonErrors },
} satisfies FastifySchema;

export const getFulfillmentSchema = {
  params: fulfillmentParams,
  response: { 200: fulfillmentResponse, ...commonErrors },
} satisfies FastifySchema;

export const retryFulfillmentSchema = {
  params: fulfillmentParams,
  response: { 200: fulfillmentResponse, ...commonErrors },
} satisfies FastifySchema;

export const syncFulfillmentStatusSchema = {
  params: fulfillmentParams,
  response: { 200: fulfillmentResponse, ...commonErrors },
} satisfies FastifySchema;
