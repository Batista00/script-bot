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

const job = {
  type: "object",
  additionalProperties: false,
  required: [
    "jobId", "jobType", "status", "attempts", "maxAttempts", "runAt",
    "lastError", "createdAt", "updatedAt",
  ],
  properties: {
    jobId: { type: "string", format: "uuid" },
    jobType: { type: "string" },
    status: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"] },
    attempts: { type: "integer" },
    maxAttempts: { type: "integer" },
    runAt: { type: "string", format: "date-time" },
    lastError: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParams = {
  type: "object",
  additionalProperties: false,
  required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const jobParams = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "jobId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    jobId: { type: "string", format: "uuid" },
  },
} as const;

export const listJobsSchema = {
  params: businessParams,
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
      offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
      status: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"] },
      jobType: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
  response: {
    200: { type: "array", items: job },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const retryJobSchema = {
  params: jobParams,
  response: {
    200: job,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
