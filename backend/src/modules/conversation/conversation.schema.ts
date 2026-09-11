import type { FastifySchema } from "fastify";

const turnBody = {
  type: "object",
  additionalProperties: false,
  required: ["remoteJid"],
  properties: {
    remoteJid: { type: "string", minLength: 3, maxLength: 200 },
    messageId: { type: "string", minLength: 1, maxLength: 160 },
    buttonId: { type: "string", minLength: 1, maxLength: 120 },
    text: { type: "string", maxLength: 10_000 },
    media: { type: "string", maxLength: 2_000 },
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
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const turnResponse = {
  type: "object",
  additionalProperties: false,
  required: ["state", "message", "renderedMessage", "expect"],
  properties: {
    state: { type: "string" },
    message: { type: "string" },
    renderedMessage: { type: "string" },
    expect: { type: "string", enum: ["button", "text", "media", "none"] },
  },
} as const;

export const conversationTurnSchema = {
  body: turnBody,
  response: { 200: turnResponse, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema },
} satisfies FastifySchema;
