import type { FastifySchema } from "fastify";

const businessResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

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

const businessIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
} as const;

const businessNameSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "\\S",
} as const;

export const createBusinessSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: businessNameSchema,
    },
  },
  response: {
    201: businessResponseSchema,
    400: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listBusinessesSchema = {
  response: {
    200: {
      type: "array",
      items: businessResponseSchema,
    },
  },
} satisfies FastifySchema;

export const getBusinessSchema = {
  params: businessIdParamsSchema,
  response: {
    200: businessResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateBusinessSchema = {
  params: businessIdParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: businessNameSchema,
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: businessResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;
