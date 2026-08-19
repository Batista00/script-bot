import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type IntegrationBusinessParams,
  IntegrationsController,
  type IntegrationIdParams,
} from "./integrations.controller.js";
import {
  createIntegrationSchema,
  getIntegrationSchema,
  listIntegrationsSchema,
  updateIntegrationSchema,
} from "./integrations.schema.js";
import { IntegrationsService } from "./integrations.service.js";
import type {
  CreateIntegrationInput,
  IntegrationListQuery,
  UpdateIntegrationInput,
} from "./integrations.types.js";

interface IntegrationsRoutesOptions { service: IntegrationsService }

export const integrationsRoutes: FastifyPluginAsync<IntegrationsRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new IntegrationsController(options.service);
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin"]),
  ];

  app.post<{ Params: IntegrationBusinessParams; Body: CreateIntegrationInput }>(
    "/businesses/:businessId/integrations",
    { schema: createIntegrationSchema, preHandler: authorization },
    controller.create,
  );
  app.get<{ Params: IntegrationBusinessParams; Querystring: IntegrationListQuery }>(
    "/businesses/:businessId/integrations",
    { schema: listIntegrationsSchema, preHandler: authorization },
    controller.list,
  );
  app.get<{ Params: IntegrationIdParams }>(
    "/businesses/:businessId/integrations/:integrationId",
    { schema: getIntegrationSchema, preHandler: authorization },
    controller.getById,
  );
  app.patch<{ Params: IntegrationIdParams; Body: UpdateIntegrationInput }>(
    "/businesses/:businessId/integrations/:integrationId",
    { schema: updateIntegrationSchema, preHandler: authorization },
    controller.update,
  );
};
