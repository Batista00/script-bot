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

const moneySchema = { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 } as const;
const nullableMoneySchema = { anyOf: [moneySchema, { type: "null" }] } as const;
const nullableQuantitySchema = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    { type: "null" },
  ],
} as const;

const priceResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "businessId", "productId", "pricingType", "currency", "fixedPrice",
    "unitPrice", "minQuantity", "maxQuantity", "status", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
    pricingType: { type: "string", enum: ["fixed", "unit"] },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    fixedPrice: nullableMoneySchema,
    unitPrice: nullableMoneySchema,
    minQuantity: nullableQuantitySchema,
    maxQuantity: nullableQuantitySchema,
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const productParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "productId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
  },
} as const;

const priceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "productId", "priceId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
    priceId: { type: "string", format: "uuid" },
  },
} as const;

const priceFieldsSchema = {
  pricingType: { type: "string", enum: ["fixed", "unit"] },
  currency: { type: "string", minLength: 3, maxLength: 3, pattern: "^[A-Za-z]{3}$" },
  fixedPrice: nullableMoneySchema,
  unitPrice: nullableMoneySchema,
  minQuantity: nullableQuantitySchema,
  maxQuantity: nullableQuantitySchema,
} as const;

export const createPriceSchema = {
  params: productParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["pricingType", "currency"],
    properties: priceFieldsSchema,
  },
  response: {
    201: priceResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listPricesSchema = {
  params: productParamsSchema,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
    },
  },
  response: {
    200: { type: "array", items: priceResponseSchema },
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getPriceSchema = {
  params: priceParamsSchema,
  response: {
    200: priceResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updatePriceSchema = {
  params: priceParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ...priceFieldsSchema,
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: priceResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
