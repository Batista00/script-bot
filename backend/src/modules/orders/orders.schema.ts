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

const nullableMoneySchema = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    { type: "null" },
  ],
} as const;

const orderItemSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "orderId", "productId", "productName", "quantity",
    "pricingType", "unitPrice", "totalPrice", "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    orderId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
    productName: { type: "string", minLength: 1, maxLength: 160 },
    quantity: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    pricingType: { type: "string", enum: ["fixed", "unit"] },
    unitPrice: nullableMoneySchema,
    totalPrice: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const orderStatusSchema = {
  type: "string",
  enum: ["pending_payment", "paid", "processing", "completed", "cancelled", "failed"],
} as const;

const orderResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "customerId", "quoteId", "status", "currency",
    "subtotal", "total", "createdAt", "updatedAt", "items",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    customerId: { type: "string", format: "uuid" },
    quoteId: { type: "string", format: "uuid" },
    status: orderStatusSchema,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    subtotal: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    total: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    items: { type: "array", items: orderItemSchema },
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

export const createOrderSchema = {
  params: businessParamsSchema,
  body: {
    type: "object", additionalProperties: false, required: ["quoteId"],
    properties: {
      quoteId: { type: "string", format: "uuid" },
      customerId: {
        anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
      },
    },
  },
  response: {
    201: orderResponseSchema, 400: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listOrdersSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object", additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      status: orderStatusSchema,
      customerId: { type: "string", format: "uuid" },
    },
  },
  response: {
    200: { type: "array", items: orderResponseSchema },
    400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getOrderSchema = {
  params: orderParamsSchema,
  response: { 200: orderResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
} satisfies FastifySchema;

export const cancelOrderSchema = {
  params: orderParamsSchema,
  response: {
    200: orderResponseSchema, 400: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema,
  },
} satisfies FastifySchema;
