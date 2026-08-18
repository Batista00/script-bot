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
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

const nullableNameSchema = {
  anyOf: [
    { type: "string", maxLength: 120 },
    { type: "null" },
  ],
} as const;

const nullablePhoneSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 64, pattern: "^\\s*\\+?[0-9(). /-]+\\s*$" },
    { type: "null" },
  ],
} as const;

const nullableEmailSchema = {
  anyOf: [
    {
      type: "string",
      minLength: 3,
      maxLength: 260,
      pattern: "^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$",
    },
    { type: "null" },
  ],
} as const;

const customerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "businessId",
    "name",
    "phone",
    "email",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    name: nullableNameSchema,
    phone: nullablePhoneSchema,
    email: nullableEmailSchema,
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
  },
} as const;

const customerParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "customerId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    customerId: { type: "string", format: "uuid" },
  },
} as const;

export const createCustomerSchema = {
  params: businessParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: nullableNameSchema,
      phone: nullablePhoneSchema,
      email: nullableEmailSchema,
    },
  },
  response: {
    201: customerResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listCustomersSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      phone: { type: "string", minLength: 1, maxLength: 64 },
      email: { type: "string", minLength: 3, maxLength: 260 },
    },
  },
  response: {
    200: { type: "array", items: customerResponseSchema },
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getCustomerSchema = {
  params: customerParamsSchema,
  response: {
    200: customerResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateCustomerSchema = {
  params: customerParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: nullableNameSchema,
      phone: nullablePhoneSchema,
      email: nullableEmailSchema,
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: customerResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
