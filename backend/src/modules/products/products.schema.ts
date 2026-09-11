import type { FastifySchema } from "fastify";
import { productDeliveryHttpSchema } from "./product-delivery.js";

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

const requiredInputsSchema = {
  type: "array", maxItems: 20,
  items: {
    type: "object", additionalProperties: false,
    required: ["key", "label", "helpText", "type", "required", "position", "validation"],
    properties: {
      key: { type: "string", pattern: "^[a-z][A-Za-z0-9]{0,63}$" },
      label: { type: "string", minLength: 1, maxLength: 160, pattern: "\\S" },
      helpText: nullableStringSchema(1000),
      type: { type: "string", enum: ["url", "text", "textarea", "integer", "date"] },
      required: { type: "boolean" },
      position: { type: "integer", minimum: 0, maximum: 19 },
      validation: {
        type: "object", additionalProperties: false,
        properties: {
          minLength: { type: "integer", minimum: 0, maximum: 10000 },
          maxLength: { type: "integer", minimum: 1, maximum: 10000 },
          minimum: { type: "integer", minimum: 0, maximum: 2147483647 },
          maximum: { type: "integer", minimum: 0, maximum: 2147483647 },
        },
      },
    },
  },
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
    "requiredInputs",
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
    requiredInputs: requiredInputsSchema,
    deliveryConfig: productDeliveryHttpSchema,
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
  requiredInputs: requiredInputsSchema,
  deliveryConfig: productDeliveryHttpSchema,
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
      search: { type: "string", minLength: 1, maxLength: 160 },
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

export const deleteProductSchema = {
  params: productParamsSchema,
  response: {
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
