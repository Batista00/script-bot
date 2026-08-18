import type { FastifySchema } from "fastify";

const userResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "name", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const authViewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["user", "businesses"],
  properties: {
    user: userResponseSchema,
    businesses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "status", "role"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          status: { type: "string", enum: ["active", "inactive"] },
          role: { type: "string", enum: ["owner", "admin", "operator"] },
        },
      },
    },
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

export const loginSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
      password: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
  response: {
    200: authViewSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const meSchema = {
  response: {
    200: authViewSchema,
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const logoutSchema = {
  response: {
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

