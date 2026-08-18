import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { PostgresCategoriesRepository } from "../categories/categories.repository.js";
import {
  type ProductBusinessParams,
  ProductsController,
  type ProductIdParams,
} from "./products.controller.js";
import { PostgresProductsRepository } from "./products.repository.js";
import {
  createProductSchema,
  getProductSchema,
  listProductsSchema,
  updateProductSchema,
} from "./products.schema.js";
import { ProductsService } from "./products.service.js";
import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
} from "./products.types.js";

export const productsRoutes: FastifyPluginAsync = async (app) => {
  const controller = new ProductsController(
    new ProductsService(
      new PostgresProductsRepository(app.db),
      new PostgresCategoriesRepository(app.db),
    ),
  );
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const allowRead = requireBusinessRole(["owner", "admin", "operator"]);
  const allowWrite = requireBusinessRole(["owner", "admin"]);
  const readAuthorization = [requireUser, requireMembership, allowRead];
  const writeAuthorization = [requireUser, requireMembership, allowWrite];

  app.post<{ Params: ProductBusinessParams; Body: CreateProductInput }>(
    "/businesses/:businessId/products",
    { schema: createProductSchema, preHandler: writeAuthorization },
    controller.create,
  );
  app.get<{ Params: ProductBusinessParams; Querystring: ProductListQuery }>(
    "/businesses/:businessId/products",
    { schema: listProductsSchema, preHandler: readAuthorization },
    controller.list,
  );
  app.get<{ Params: ProductIdParams }>(
    "/businesses/:businessId/products/:productId",
    { schema: getProductSchema, preHandler: readAuthorization },
    controller.getById,
  );
  app.patch<{ Params: ProductIdParams; Body: UpdateProductInput }>(
    "/businesses/:businessId/products/:productId",
    { schema: updateProductSchema, preHandler: writeAuthorization },
    controller.update,
  );
};
