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
  getProviderCatalogStateSchema,
  listProviderServicesSchema,
  syncProviderServicesSchema,
  updateProviderMappingSchema,
} from "./provider-catalog.schema.js";
import { ProviderCatalogService } from "./provider-catalog.service.js";
import {
  ProviderProductImportController,
  type ProviderProductImportParams,
} from "./provider-product-import.controller.js";
import { importProviderServiceSchema } from "./provider-product-import.schema.js";
import type { ImportProviderServiceInput } from "./provider-product-import.types.js";
import { ProviderProductImportService } from "./provider-product-import.service.js";
import type {
  CreateProductProviderMappingInput,
  ProviderServiceListQuery,
  UpdateProductProviderMappingInput,
} from "./provider-catalog.types.js";

interface ProviderCatalogRoutesOptions {
  service: ProviderCatalogService;
  importService: ProviderProductImportService;
}

export const providerCatalogRoutes: FastifyPluginAsync<ProviderCatalogRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new ProviderCatalogController(options.service);
  const importController = new ProviderProductImportController(options.importService);
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
  app.get<{ Params: ProviderCatalogSyncParams }>(
    "/businesses/:businessId/integrations/:integrationId/provider-catalog/state",
    { schema: getProviderCatalogStateSchema, preHandler: read },
    controller.getCatalogState,
  );
  app.post<{ Params: ProviderProductImportParams; Body: ImportProviderServiceInput }>(
    "/businesses/:businessId/provider-services/import-product",
    { schema: importProviderServiceSchema, preHandler: write },
    importController.import,
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
