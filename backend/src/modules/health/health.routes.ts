import type { FastifyPluginAsync } from "fastify";

import { createReadinessHandler, getHealth } from "./health.controller.js";

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", const: "ok" },
  },
} as const;

const readinessResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "database"],
  properties: {
    status: { type: "string", enum: ["ok", "unavailable"] },
    database: { type: "string", enum: ["ok", "unavailable"] },
  },
} as const;

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    { schema: { response: { 200: healthResponseSchema } } },
    getHealth,
  );
  app.get(
    "/health/ready",
    { schema: { response: { 200: readinessResponseSchema, 503: readinessResponseSchema } } },
    createReadinessHandler(app.db),
  );
};
