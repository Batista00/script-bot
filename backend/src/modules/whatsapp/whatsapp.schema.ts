import type { FastifySchema } from "fastify";

import { conversationStatuses, messageDirections, messageStatuses } from "./whatsapp.types.js";

const errorResponseSchema = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;

const nullableStringSchema = (maxLength: number) => ({
  anyOf: [{ type: "string", maxLength }, { type: "null" }],
});

const conversationResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "customerId", "channel", "status",
    "lastMessageAt", "unreadCount", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    customerId: { type: "string", format: "uuid" },
    channel: { type: "string", pattern: "^[a-z][a-z0-9_]{0,31}$" },
    status: { type: "string", enum: [...conversationStatuses] },
    lastMessageAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    unreadCount: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const messageResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "id", "businessId", "conversationId", "direction", "externalMessageId",
    "body", "mediaType", "mediaUrl", "status", "providerError", "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    conversationId: { type: "string", format: "uuid" },
    direction: { type: "string", enum: [...messageDirections] },
    externalMessageId: nullableStringSchema(200),
    body: nullableStringSchema(8192),
    mediaType: nullableStringSchema(64),
    mediaUrl: nullableStringSchema(2048),
    status: { type: "string", enum: [...messageStatuses] },
    providerError: nullableStringSchema(1000),
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const businessParamsSchema = {
  type: "object", additionalProperties: false, required: ["businessId"],
  properties: { businessId: { type: "string", format: "uuid" } },
} as const;

const conversationParamsSchema = {
  type: "object", additionalProperties: false,
  required: ["businessId", "conversationId"],
  properties: {
    businessId: { type: "string", format: "uuid" },
    conversationId: { type: "string", format: "uuid" },
  },
} as const;

const listQuerySchema = {
  type: "object", additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
  },
} as const;

const evolutionMediaSchema = {
  type: "object", additionalProperties: true,
  properties: {
    mimetype: { type: "string", maxLength: 200 },
    url: { type: "string", maxLength: 8192 },
  },
} as const;

const evolutionWebhookBodySchema = {
  type: "object", additionalProperties: true, required: ["event", "data"],
  properties: {
    event: { type: "string", minLength: 1, maxLength: 64 },
    instance: { type: "string", maxLength: 200 },
    data: {
      type: "object", additionalProperties: true,
      properties: {
        key: {
          type: "object", additionalProperties: true,
          properties: {
            remoteJid: { type: "string", maxLength: 200 },
            fromMe: { anyOf: [{ type: "boolean" }, { type: "string", maxLength: 8 }] },
            id: { type: "string", maxLength: 200 },
          },
        },
        pushName: { type: "string", maxLength: 400 },
        messageType: { type: "string", maxLength: 64 },
        message: {
          type: "object", additionalProperties: true,
          properties: {
            conversation: { type: "string", maxLength: 20000 },
            extendedTextMessage: {
              type: "object", additionalProperties: true,
              properties: { text: { type: "string", maxLength: 20000 } },
            },
            imageMessage: evolutionMediaSchema,
            audioMessage: evolutionMediaSchema,
            documentMessage: evolutionMediaSchema,
          },
        },
      },
    },
  },
} as const;

const webhookIgnoredResponseSchema = {
  type: "object", additionalProperties: false, required: ["ignored"],
  properties: { ignored: { type: "boolean", const: true } },
} as const;

const webhookContextResponseSchema = {
  type: "object", additionalProperties: false,
  required: [
    "conversationId", "customerId", "phone", "name", "text",
    "mediaType", "mediaUrl", "isNewConversation", "duplicate",
  ],
  properties: {
    conversationId: { type: "string", format: "uuid" },
    customerId: { type: "string", format: "uuid" },
    phone: { type: "string", pattern: "^\\+?[0-9]{1,32}$" },
    name: nullableStringSchema(120),
    text: nullableStringSchema(8192),
    mediaType: nullableStringSchema(64),
    mediaUrl: nullableStringSchema(2048),
    isNewConversation: { type: "boolean" },
    duplicate: { type: "boolean" },
  },
} as const;

export const evolutionWebhookSchema = {
  params: {
    type: "object", additionalProperties: false, required: ["integrationId"],
    properties: { integrationId: { type: "string", format: "uuid" } },
  },
  headers: {
    type: "object",
    properties: { "x-webhook-secret": { type: "string", minLength: 1, maxLength: 4096 } },
  },
  body: evolutionWebhookBodySchema,
  response: {
    200: { anyOf: [webhookContextResponseSchema, webhookIgnoredResponseSchema] },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listConversationsSchema = {
  params: businessParamsSchema,
  querystring: {
    ...listQuerySchema,
    properties: {
      ...listQuerySchema.properties,
      status: { type: "string", enum: [...conversationStatuses] },
    },
  },
  response: {
    200: { type: "array", items: conversationResponseSchema },
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listConversationMessagesSchema = {
  params: conversationParamsSchema,
  querystring: listQuerySchema,
  response: {
    200: { type: "array", items: messageResponseSchema },
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const updateConversationSchema = {
  params: conversationParamsSchema,
  body: {
    type: "object", additionalProperties: false, required: ["status"],
    properties: { status: { type: "string", enum: [...conversationStatuses] } },
  },
  response: {
    200: conversationResponseSchema,
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema,
  },
} satisfies FastifySchema;

export const sendConversationMessageSchema = {
  params: conversationParamsSchema,
  body: {
    type: "object", additionalProperties: false, required: ["text"],
    properties: { text: { type: "string", minLength: 1, maxLength: 8192 } },
  },
  response: {
    201: messageResponseSchema,
    400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
    404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema,
  },
} satisfies FastifySchema;
