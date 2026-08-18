import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { PostgresProductsRepository } from "../products/products.repository.js";
import {
  type PriceIdParams,
  PricingController,
  type PricingProductParams,
} from "./pricing.controller.js";
import { PostgresPricingRepository } from "./pricing.repository.js";
import {
  createPriceSchema,
  getPriceSchema,
  listPricesSchema,
  updatePriceSchema,
} from "./pricing.schema.js";
import { PricingService } from "./pricing.service.js";
import type {
  CreateProductPriceInput,
  ProductPriceListQuery,
  UpdateProductPriceInput,
} from "./pricing.types.js";

export const pricingRoutes: FastifyPluginAsync = async (app) => {
  const controller = new PricingController(
    new PricingService(
      new PostgresPricingRepository(app.db),
      new PostgresProductsRepository(app.db),
    ),
  );
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const allowRead = requireBusinessRole(["owner", "admin", "operator"]);
  const allowWrite = requireBusinessRole(["owner", "admin"]);
  const readAuthorization = [requireUser, requireMembership, allowRead];
  const writeAuthorization = [requireUser, requireMembership, allowWrite];

  app.post<{ Params: PricingProductParams; Body: CreateProductPriceInput }>(
    "/businesses/:businessId/products/:productId/prices",
    { schema: createPriceSchema, preHandler: writeAuthorization },
    controller.create,
  );
  app.get<{ Params: PricingProductParams; Querystring: ProductPriceListQuery }>(
    "/businesses/:businessId/products/:productId/prices",
    { schema: listPricesSchema, preHandler: readAuthorization },
    controller.list,
  );
  app.get<{ Params: PriceIdParams }>(
    "/businesses/:businessId/products/:productId/prices/:priceId",
    { schema: getPriceSchema, preHandler: readAuthorization },
    controller.getById,
  );
  app.patch<{ Params: PriceIdParams; Body: UpdateProductPriceInput }>(
    "/businesses/:businessId/products/:productId/prices/:priceId",
    { schema: updatePriceSchema, preHandler: writeAuthorization },
    controller.update,
  );
};
