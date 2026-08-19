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

export const mercadoPagoWebhookSchema = {
  params: {
    type: "object", additionalProperties: false, required: ["integrationId"],
    properties: { integrationId: { type: "string", format: "uuid" } },
  },
  querystring: {
    type: "object", additionalProperties: true, required: ["data.id", "type"],
    properties: {
      "data.id": { type: "string", pattern: "^[0-9]{1,32}$" },
      type: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
  headers: {
    type: "object",
    properties: {
      "x-signature": { type: "string", minLength: 1, maxLength: 512 },
      "x-request-id": { type: "string", minLength: 1, maxLength: 128 },
    },
  },
  response: {
    200: {
      type: "object", additionalProperties: false, required: ["status"],
      properties: { status: { type: "string", const: "ok" } },
    },
    400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema,
    409: errorResponseSchema, 503: errorResponseSchema,
  },
} satisfies FastifySchema;
