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

const membershipUserSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "name", "status"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] },
  },
} as const;

const membershipSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "businessId", "userId", "role", "status", "createdAt", "updatedAt", "user",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    userId: { type: "string", format: "uuid" },
    role: { type: "string", enum: ["owner", "admin", "operator"] },
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    user: membershipUserSchema,
  },
} as const;

const businessParams = {
  type: "object",
  additionalProperties: false,
  required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const membershipParams = {
  type: "object",
  additionalProperties: false,
  required: ["businessId", "membershipId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    membershipId: { type: "string", format: "uuid" },
  },
} as const;

export const listMembershipsSchema = {
  params: businessParams,
  response: {
    200: { type: "array", items: membershipSchema },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const createMembershipSchema = {
  params: businessParams,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email", "role"],
    properties: {
      email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
      name: { type: ["string", "null"], maxLength: 120 },
      password: { type: ["string", "null"], maxLength: 128 },
      role: { type: "string", enum: ["owner", "admin", "operator"] },
    },
  },
  response: {
    201: membershipSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateMembershipSchema = {
  params: membershipParams,
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      role: { type: "string", enum: ["owner", "admin", "operator"] },
      status: { type: "string", enum: ["active", "inactive"] },
    },
  },
  response: {
    200: membershipSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const deleteMembershipSchema = {
  params: membershipParams,
  response: {
    204: { type: "null" },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} satisfies FastifySchema;
