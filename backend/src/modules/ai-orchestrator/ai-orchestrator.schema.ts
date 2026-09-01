import type { FastifySchema } from "fastify";
import { z } from "zod";

import {
  aiIntents,
  aiPlatforms,
  aiServices,
} from "./ai-orchestrator.types.js";

export const aiAssistantRequestSchemaZod = z.object({
  message: z.string().trim().min(1).max(2000),
  customerId: z.string().uuid().nullable().optional(),
  conversationId: z.string().trim().min(1).max(128).nullable().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const aiInterpretationSchemaZod = z.object({
  intent: z.enum(aiIntents),
  confidence: z.number().min(0).max(1),
  entities: z.object({
    platform: z.enum(aiPlatforms).nullable(),
    service: z.enum(aiServices).nullable(),
    quantity: z.number().int().positive().nullable(),
    urls: z.array(z.string().url()).max(20),
    paymentMethod: z.string().trim().min(1).max(80).nullable(),
    searchTerms: z.array(z.string().trim().min(1).max(40)).max(6),
  }).strict(),
}).strict();

export const aiAssistantMessageSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
      message: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
      },
      customerId: {
        anyOf: [
          { type: "string", format: "uuid" },
          { type: "null" },
        ],
      },
      conversationId: {
        anyOf: [
          { type: "string", minLength: 1, maxLength: 128 },
          { type: "null" },
        ],
      },
      context: {
        type: "object",
        additionalProperties: true,
        maxProperties: 50,
      },
    },
  },
} satisfies FastifySchema;

export const openAiInterpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "entities"],
  properties: {
    intent: {
      type: "string",
      enum: [...aiIntents],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    entities: {
      type: "object",
      additionalProperties: false,
      required: [
        "platform",
        "service",
        "quantity",
        "urls",
        "paymentMethod",
        "searchTerms",
      ],
      properties: {
        platform: {
          anyOf: [
            { type: "string", enum: [...aiPlatforms] },
            { type: "null" },
          ],
        },
        service: {
          anyOf: [
            { type: "string", enum: [...aiServices] },
            { type: "null" },
          ],
        },
        quantity: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "null" },
          ],
        },
        urls: {
          type: "array",
          maxItems: 20,
          items: { type: "string" },
        },
        paymentMethod: {
          anyOf: [
            { type: "string", maxLength: 80 },
            { type: "null" },
          ],
        },
        searchTerms: {
          type: "array",
          maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 40 },
        },
      },
    },
  },
} as const;
