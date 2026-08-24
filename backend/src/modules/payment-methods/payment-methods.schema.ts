import type { FastifySchema } from "fastify";

const errorResponse = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: { error: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
} as const;

const params = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;
const itemParams = {
  type: "object", additionalProperties: false, required: ["businessId", "paymentMethodId"],
  properties: { businessId: { type: "string", format: "uuid" }, paymentMethodId: { type: "string", format: "uuid" } },
} as const;
const config = { type: "object", additionalProperties: true, maxProperties: 8 } as const;
const item = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "type", "name", "status", "config", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" }, businessId: { type: "string", format: "uuid" },
    type: { type: "string", enum: ["mercado_pago", "bank_transfer"] },
    name: { type: "string" }, status: { type: "string", enum: ["active", "inactive"] },
    config, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const createPaymentMethodSchema = {
  params,
  body: { type: "object", additionalProperties: false, required: ["type", "name"], properties: { type: { type: "string", enum: ["mercado_pago", "bank_transfer"] }, name: { type: "string", minLength: 1, maxLength: 120 }, config } },
  response: { 201: item, 400: errorResponse, 409: errorResponse },
} satisfies FastifySchema;
export const listPaymentMethodsSchema = {
  params, querystring: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["active", "inactive"] } } },
  response: { 200: { type: "array", items: item }, 400: errorResponse },
} satisfies FastifySchema;
export const updatePaymentMethodSchema = {
  params: itemParams,
  body: { type: "object", additionalProperties: false, minProperties: 1, properties: { name: { type: "string", minLength: 1, maxLength: 120 }, status: { type: "string", enum: ["active", "inactive"] }, config } },
  response: { 200: item, 400: errorResponse, 404: errorResponse, 409: errorResponse },
} satisfies FastifySchema;
export const deletePaymentMethodSchema = {
  params: itemParams, response: { 204: { type: "null" }, 404: errorResponse, 409: errorResponse },
} satisfies FastifySchema;
