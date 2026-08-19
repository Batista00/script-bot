import type { FastifySchema } from "fastify";

const uuid = { type: "string", format: "uuid" } as const;
const error = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;
const credential = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "name", "prefix", "status", "createdAt", "updatedAt"],
  properties: {
    id: uuid, businessId: uuid,
    name: { type: "string" }, prefix: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const businessParams = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: uuid },
} as const;
const idParams = {
  type: "object", additionalProperties: false, required: ["businessId", "credentialId"],
  properties: { businessId: uuid, credentialId: uuid },
} as const;
const errors = { 400: error, 401: error, 403: error, 404: error } as const;

export const createApiCredentialSchema = {
  params: businessParams,
  body: {
    type: "object", additionalProperties: false, required: ["name"],
    properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
  },
  response: {
    201: {
      type: "object", additionalProperties: false, required: ["credential", "token"],
      properties: { credential, token: { type: "string" } },
    },
    ...errors,
  },
} satisfies FastifySchema;

export const listApiCredentialsSchema = {
  params: businessParams,
  response: { 200: { type: "array", items: credential }, ...errors },
} satisfies FastifySchema;

export const getApiCredentialSchema = {
  params: idParams, response: { 200: credential, ...errors },
} satisfies FastifySchema;

export const updateApiCredentialSchema = {
  params: idParams,
  body: {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: { 200: credential, ...errors },
} satisfies FastifySchema;
