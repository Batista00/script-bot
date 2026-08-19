import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type ApiCredentialBusinessParams,
  ApiCredentialsController,
  type ApiCredentialIdParams,
} from "./api-credentials.controller.js";
import {
  createApiCredentialSchema,
  getApiCredentialSchema,
  listApiCredentialsSchema,
  updateApiCredentialSchema,
} from "./api-credentials.schema.js";
import { ApiCredentialsService } from "./api-credentials.service.js";
import type {
  CreateApiCredentialInput,
  UpdateApiCredentialInput,
} from "./api-credentials.types.js";

interface ApiCredentialsRoutesOptions { service: ApiCredentialsService }

export const apiCredentialsRoutes: FastifyPluginAsync<ApiCredentialsRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new ApiCredentialsController(options.service);
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin"]),
  ];
  app.post<{ Params: ApiCredentialBusinessParams; Body: CreateApiCredentialInput }>(
    "/businesses/:businessId/api-credentials",
    { schema: createApiCredentialSchema, preHandler: authorization },
    controller.create,
  );
  app.get<{ Params: ApiCredentialBusinessParams }>(
    "/businesses/:businessId/api-credentials",
    { schema: listApiCredentialsSchema, preHandler: authorization },
    controller.list,
  );
  app.get<{ Params: ApiCredentialIdParams }>(
    "/businesses/:businessId/api-credentials/:credentialId",
    { schema: getApiCredentialSchema, preHandler: authorization },
    controller.getById,
  );
  app.patch<{ Params: ApiCredentialIdParams; Body: UpdateApiCredentialInput }>(
    "/businesses/:businessId/api-credentials/:credentialId",
    { schema: updateApiCredentialSchema, preHandler: authorization },
    controller.update,
  );
};
