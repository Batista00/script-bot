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

const statusSchema = { type: "string", enum: ["active", "inactive"] } as const;
const providerKeySchema = {
  type: "string", minLength: 1, maxLength: 66, pattern: "\\S",
} as const;
const jsonObjectSchema = { type: "object", additionalProperties: true } as const;
const credentialsSchema = {
  type: "object", additionalProperties: true, minProperties: 1,
} as const;

const integrationResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "providerKey", "status", "config", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    providerKey: { type: "string", pattern: "^[a-z0-9][a-z0-9_]{0,63}$" },
    status: statusSchema,
    config: jsonObjectSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const integrationParamsSchema = {
  type: "object", additionalProperties: false,
  required: ["businessId", "integrationId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    integrationId: { type: "string", format: "uuid" },
  },
} as const;

export const createIntegrationSchema = {
  params: businessParamsSchema,
  body: {
    type: "object", additionalProperties: false,
    required: ["providerKey", "credentials"],
    properties: {
      providerKey: providerKeySchema,
      config: jsonObjectSchema,
      credentials: credentialsSchema,
    },
  },
  response: {
    201: integrationResponseSchema, 400: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema, 500: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listIntegrationsSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object", additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      status: statusSchema,
      providerKey: providerKeySchema,
    },
  },
  response: {
    200: { type: "array", items: integrationResponseSchema },
    400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getIntegrationSchema = {
  params: integrationParamsSchema,
  response: {
    200: integrationResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateIntegrationSchema = {
  params: integrationParamsSchema,
  body: {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: {
      status: statusSchema,
      config: jsonObjectSchema,
      credentials: credentialsSchema,
    },
  },
  response: {
    200: integrationResponseSchema, 400: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema, 500: errorResponseSchema,
  },
} satisfies FastifySchema;
