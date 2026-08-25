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
const orderFieldSchema = {
  type: "object", additionalProperties: false,
  required: ["key", "providerField", "type"],
  properties: {
    key: { type: "string" }, providerField: { type: "string" },
    type: { type: "string", enum: ["url", "text", "textarea", "integer", "date"] },
  },
} as const;
const capabilitiesSchema = {
  type: "object", additionalProperties: false,
  required: ["supported", "required", "optional"],
  properties: {
    supported: { type: "boolean" },
    required: { type: "array", items: orderFieldSchema },
    optional: { type: "array", items: orderFieldSchema },
    source: { type: "string", enum: ["official", "unverified"] },
    unsupportedReason: { type: "string" },
  },
} as const;
const serviceResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "integrationId", "providerKey", "externalServiceId",
    "name", "category", "serviceType", "rate", "rateCurrency", "minQuantity",
    "maxQuantity", "providerDescription", "orderCapabilities", "providerStatus",
    "mappingCount", "metadata", "lastSyncedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: uuidSchema, businessId: uuidSchema, integrationId: uuidSchema,
    providerKey: { type: "string" }, externalServiceId: { type: "string" },
    name: { type: "string" }, category: { type: ["string", "null"] },
    serviceType: { type: ["string", "null"] }, rate: { type: ["string", "null"] },
    rateCurrency: { type: ["string", "null"] },
    minQuantity: { type: ["integer", "null"] }, maxQuantity: { type: ["integer", "null"] },
    providerDescription: { type: ["string", "null"] }, orderCapabilities: capabilitiesSchema,
    providerStatus: statusSchema, mappingCount: { type: "integer", minimum: 0 },
    metadata: { type: "object", additionalProperties: true },
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
      externalServiceId: {
        type: "string", minLength: 1, maxLength: 64,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      serviceType: { type: "string", minLength: 1, maxLength: 255 },
      search: { type: "string", minLength: 1, maxLength: 160 },
      mappingStatus: { type: "string", enum: ["mapped", "unmapped"] },
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
      required: ["integrationId", "providerKey", "received", "normalized", "rejected",
        "rejectionReasons", "created", "updated", "reactivated", "deactivated"],
      properties: {
        integrationId: uuidSchema, providerKey: { type: "string" },
        received: { type: "integer", minimum: 0 }, created: { type: "integer", minimum: 0 },
        normalized: { type: "integer", minimum: 0 }, rejected: { type: "integer", minimum: 0 },
        rejectionReasons: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        updated: { type: "integer", minimum: 0 }, reactivated: { type: "integer", minimum: 0 },
        deactivated: { type: "integer", minimum: 0 },
      },
    },
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema,
    503: errorResponseSchema,
  },
} satisfies FastifySchema;

export const getProviderCatalogStateSchema = {
  params: {
    type: "object", additionalProperties: false,
    required: ["businessId", "integrationId"],
    properties: { businessId: uuidSchema, integrationId: uuidSchema },
  },
  response: {
    200: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false,
        required: ["businessId", "integrationId", "connectionStatus", "providerBalance",
          "providerCurrency", "servicesReceived", "servicesNormalized", "servicesRejected",
          "rejectionReasons", "lastSyncAt", "lastBalanceAt", "lastErrorCode", "updatedAt"],
        properties: {
          businessId: uuidSchema, integrationId: uuidSchema,
          connectionStatus: { type: "string", enum: ["unknown", "ok", "error"] },
          providerBalance: { type: ["string", "null"] },
          providerCurrency: { type: ["string", "null"] },
          servicesReceived: { type: "integer", minimum: 0 },
          servicesNormalized: { type: "integer", minimum: 0 },
          servicesRejected: { type: "integer", minimum: 0 },
          rejectionReasons: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          lastSyncAt: { type: ["string", "null"], format: "date-time" },
          lastBalanceAt: { type: ["string", "null"], format: "date-time" },
          lastErrorCode: { type: ["string", "null"] },
          updatedAt: { type: "string", format: "date-time" },
        },
      }],
    },
    400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema,
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
