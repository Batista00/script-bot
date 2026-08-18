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

const categoryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "businessId", "name", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    name: { type: "string" },
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

const categoryParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "categoryId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    categoryId: { type: "string", format: "uuid" },
  },
} as const;

const categoryNameSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "\\S",
} as const;

export const createCategorySchema = {
  params: businessParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: categoryNameSchema },
  },
  response: {
    201: categoryResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listCategoriesSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: { type: "array", items: categoryResponseSchema },
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getCategorySchema = {
  params: categoryParamsSchema,
  response: {
    200: categoryResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateCategorySchema = {
  params: categoryParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: categoryNameSchema,
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: categoryResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
