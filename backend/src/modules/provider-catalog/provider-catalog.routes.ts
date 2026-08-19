import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  ProductProviderMappingParams,
  ProviderCatalogBusinessParams,
  ProviderCatalogController,
  ProviderCatalogSyncParams,
  ProviderServiceParams,
} from "./provider-catalog.controller.js";
import {
  createProviderMappingSchema,
  getProviderMappingSchema,
  getProviderServiceSchema,
  listProviderServicesSchema,
  syncProviderServicesSchema,
  updateProviderMappingSchema,
} from "./provider-catalog.schema.js";
import { ProviderCatalogService } from "./provider-catalog.service.js";
import type {
  CreateProductProviderMappingInput,
  ProviderServiceListQuery,
  UpdateProductProviderMappingInput,
} from "./provider-catalog.types.js";

interface ProviderCatalogRoutesOptions { service: ProviderCatalogService }

export const providerCatalogRoutes: FastifyPluginAsync<ProviderCatalogRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new ProviderCatalogController(options.service);
  const membership = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
  ];
  const read = [...membership, requireBusinessRole(["owner", "admin", "operator"])];
  const write = [...membership, requireBusinessRole(["owner", "admin"])];

  app.get<{ Params: ProviderCatalogBusinessParams; Querystring: ProviderServiceListQuery }>(
    "/businesses/:businessId/provider-services",
    { schema: listProviderServicesSchema, preHandler: read },
    controller.listServices,
  );
  app.get<{ Params: ProviderServiceParams }>(
    "/businesses/:businessId/provider-services/:providerServiceId",
    { schema: getProviderServiceSchema, preHandler: read },
    controller.getServiceById,
  );
  app.post<{ Params: ProviderCatalogSyncParams }>(
    "/businesses/:businessId/integrations/:integrationId/provider-services/sync",
    { schema: syncProviderServicesSchema, preHandler: write },
    controller.sync,
  );
  app.post<{
    Params: ProductProviderMappingParams;
    Body: CreateProductProviderMappingInput;
  }>(
    "/businesses/:businessId/products/:productId/provider-mapping",
    { schema: createProviderMappingSchema, preHandler: write },
    controller.createMapping,
  );
  app.get<{ Params: ProductProviderMappingParams }>(
    "/businesses/:businessId/products/:productId/provider-mapping",
    { schema: getProviderMappingSchema, preHandler: read },
    controller.getMapping,
  );
  app.patch<{
    Params: ProductProviderMappingParams;
    Body: UpdateProductProviderMappingInput;
  }>(
    "/businesses/:businessId/products/:productId/provider-mapping",
    { schema: updateProviderMappingSchema, preHandler: write },
    controller.updateMapping,
  );
};
