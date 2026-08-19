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
const uuidSchema = { type: "string", format: "uuid" } as const;
const businessParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: uuidSchema },
} as const;
const serviceResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "integrationId", "providerKey", "externalServiceId",
    "name", "category", "serviceType", "rate", "rateCurrency", "minQuantity",
    "maxQuantity", "providerStatus", "metadata", "lastSyncedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: uuidSchema, businessId: uuidSchema, integrationId: uuidSchema,
    providerKey: { type: "string" }, externalServiceId: { type: "string" },
    name: { type: "string" }, category: { type: ["string", "null"] },
    serviceType: { type: ["string", "null"] }, rate: { type: ["string", "null"] },
    rateCurrency: { type: ["string", "null"] },
    minQuantity: { type: ["integer", "null"] }, maxQuantity: { type: ["integer", "null"] },
    providerStatus: statusSchema, metadata: { type: "object", additionalProperties: true },
    lastSyncedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const mappingResponseSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "productId", "providerServiceId", "status", "createdAt", "updatedAt"],
  properties: {
    id: uuidSchema, businessId: uuidSchema, productId: uuidSchema,
    providerServiceId: uuidSchema, status: statusSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const mappingParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId", "productId"],
  properties: { businessId: uuidSchema, productId: uuidSchema },
} as const;

export const listProviderServicesSchema = {
  params: businessParamsSchema,
  querystring: {
    type: "object", additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      integrationId: uuidSchema,
      providerKey: { type: "string", minLength: 1, maxLength: 64 },
      providerStatus: statusSchema,
      category: { type: "string", minLength: 1, maxLength: 255 },
    },
  },
  response: {
    200: { type: "array", items: serviceResponseSchema },
    400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getProviderServiceSchema = {
  params: {
    type: "object", additionalProperties: false,
    required: ["businessId", "providerServiceId"],
    properties: { businessId: uuidSchema, providerServiceId: uuidSchema },
  },
  response: {
    200: serviceResponseSchema, 400: errorResponseSchema,
    401: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const syncProviderServicesSchema = {
  params: {
    type: "object", additionalProperties: false,
    required: ["businessId", "integrationId"],
    properties: { businessId: uuidSchema, integrationId: uuidSchema },
  },
  response: {
    200: {
      type: "object", additionalProperties: false,
      required: ["integrationId", "providerKey", "received", "created", "updated", "deactivated"],
      properties: {
        integrationId: uuidSchema, providerKey: { type: "string" },
        received: { type: "integer", minimum: 0 }, created: { type: "integer", minimum: 0 },
        updated: { type: "integer", minimum: 0 }, deactivated: { type: "integer", minimum: 0 },
      },
    },
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema,
    503: errorResponseSchema,
  },
} satisfies FastifySchema;

export const createProviderMappingSchema = {
  params: mappingParamsSchema,
  body: {
    type: "object", additionalProperties: false, required: ["providerServiceId"],
    properties: { providerServiceId: uuidSchema },
  },
  response: {
    201: mappingResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema,
    403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getProviderMappingSchema = {
  params: mappingParamsSchema,
  response: {
    200: mappingResponseSchema, 400: errorResponseSchema,
    401: errorResponseSchema, 404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateProviderMappingSchema = {
  params: mappingParamsSchema,
  body: {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: { providerServiceId: uuidSchema, status: statusSchema },
  },
  response: {
    200: mappingResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema,
    403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema,
  },
} satisfies FastifySchema;
