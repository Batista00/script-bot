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

const nullableStringSchema = (maxLength: number) =>
  ({
    anyOf: [
      { type: "string", maxLength },
      { type: "null" },
    ],
  }) as const;

const nullableUuidSchema = {
  anyOf: [
    { type: "string", format: "uuid" },
    { type: "null" },
  ],
} as const;

const nullableQuantitySchema = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    { type: "null" },
  ],
} as const;

const productResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "businessId",
    "categoryId",
    "name",
    "description",
    "type",
    "sku",
    "minQuantity",
    "maxQuantity",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    categoryId: nullableUuidSchema,
    name: { type: "string" },
    description: nullableStringSchema(5000),
    type: { type: "string", enum: ["service", "product"] },
    sku: nullableStringSchema(64),
    minQuantity: nullableQuantitySchema,
    maxQuantity: nullableQuantitySchema,
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
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

const productNameSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "\\S",
} as const;

const productFieldsSchema = {
  categoryId: nullableUuidSchema,
  name: productNameSchema,
  description: nullableStringSchema(5000),
  type: { type: "string", enum: ["service", "product"] },
  sku: nullableStringSchema(64),
  minQuantity: nullableQuantitySchema,
  maxQuantity: nullableQuantitySchema,
} as const;

export const createProductSchema = {
  params: businessParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name", "type"],
    properties: productFieldsSchema,
  },
  response: {
    201: productResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listProductsSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      status: { type: "string", enum: ["active", "inactive"] },
      type: { type: "string", enum: ["service", "product"] },
      categoryId: { type: "string", format: "uuid" },
    },
  },
  response: {
    200: { type: "array", items: productResponseSchema },
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getProductSchema = {
  params: productParamsSchema,
  response: {
    200: productResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateProductSchema = {
  params: productParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ...productFieldsSchema,
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: productResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
