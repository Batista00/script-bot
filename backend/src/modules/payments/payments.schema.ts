import type { FastifySchema } from "fastify";

const errorResponseSchema = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const paymentStatusSchema = {
  type: "string",
  enum: ["pending", "approved", "rejected", "cancelled", "expired", "failed"],
} as const;

const nullableStringSchema = (maxLength: number) => ({
  anyOf: [{ type: "string", minLength: 1, maxLength }, { type: "null" }],
} as const);

const nullableDateSchema = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;

const paymentResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "orderId", "providerKey", "providerReferenceId",
    "providerPaymentId", "status",
    "amount", "currency", "checkoutUrl", "idempotencyKey", "expiresAt",
    "approvedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    orderId: { type: "string", format: "uuid" },
    providerKey: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
    providerReferenceId: nullableStringSchema(255),
    providerPaymentId: nullableStringSchema(255),
    status: paymentStatusSchema,
    amount: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    checkoutUrl: nullableStringSchema(2048),
    idempotencyKey: nullableStringSchema(128),
    expiresAt: nullableDateSchema,
    approvedAt: nullableDateSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const orderParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId", "orderId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    orderId: { type: "string", format: "uuid" },
  },
} as const;

const paymentParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId", "paymentId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    paymentId: { type: "string", format: "uuid" },
  },
} as const;

const paginationProperties = {
  limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
  offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
} as const;

export const createPaymentSchema = {
  params: orderParamsSchema,
  headers: {
    type: "object",
    properties: {
      "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
    },
  },
  body: {
    type: "object", additionalProperties: false, required: ["providerKey"],
    properties: { providerKey: { type: "string", minLength: 1, maxLength: 66 } },
  },
  response: {
    200: paymentResponseSchema, 201: paymentResponseSchema,
    400: errorResponseSchema, 404: errorResponseSchema,
    409: errorResponseSchema, 503: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listPaymentsSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object", additionalProperties: false,
    properties: {
      ...paginationProperties,
      status: paymentStatusSchema,
      orderId: { type: "string", format: "uuid" },
      providerKey: { type: "string", minLength: 1, maxLength: 66 },
    },
  },
  response: {
    200: { type: "array", items: paymentResponseSchema },
    400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getPaymentSchema = {
  params: paymentParamsSchema,
  response: {
    200: paymentResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listOrderPaymentsSchema = {
  params: orderParamsSchema,
  querystring: {
    type: "object", additionalProperties: false, properties: paginationProperties,
  },
  response: {
    200: { type: "array", items: paymentResponseSchema },
    400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;
