import type { FastifySchema } from "fastify";

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const nullableUuidSchema = {
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
} as const;

const nullableMoneySchema = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    { type: "null" },
  ],
} as const;

const nullableDateSchema = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;

const quoteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "businessId", "customerId", "productId", "quantity", "productName",
    "currency", "pricingType", "unitPrice", "totalPrice", "status", "expiresAt",
    "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    customerId: nullableUuidSchema,
    productId: { type: "string", format: "uuid" },
    quantity: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    productName: { type: "string", minLength: 1, maxLength: 160 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    pricingType: { type: "string", enum: ["fixed", "unit"] },
    unitPrice: nullableMoneySchema,
    totalPrice: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 },
    status: { type: "string", enum: ["active", "expired", "converted", "cancelled"] },
    expiresAt: nullableDateSchema,
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const quoteParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "quoteId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    quoteId: { type: "string", format: "uuid" },
  },
} as const;

export const createQuoteSchema = {
  params: businessParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["productId", "quantity", "currency"],
    properties: {
      productId: { type: "string", format: "uuid" },
      quantity: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
      currency: { type: "string", minLength: 3, maxLength: 3, pattern: "^[A-Za-z]{3}$" },
      customerId: nullableUuidSchema,
      expiresAt: nullableDateSchema,
    },
  },
  response: {
    201: quoteResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listQuotesSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      customerId: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
    },
  },
  response: {
    200: { type: "array", items: quoteResponseSchema },
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getQuoteSchema = {
  params: quoteParamsSchema,
  response: {
    200: quoteResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;
