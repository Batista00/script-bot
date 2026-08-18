import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  CategoriesController,
  type CategoryBusinessParams,
  type CategoryIdParams,
} from "./categories.controller.js";
import { PostgresCategoriesRepository } from "./categories.repository.js";
import {
  createCategorySchema,
  getCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from "./categories.schema.js";
import { CategoriesService } from "./categories.service.js";
import type {
  CategoryListQuery,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./categories.types.js";

export const categoriesRoutes: FastifyPluginAsync = async (app) => {
  const controller = new CategoriesController(
    new CategoriesService(new PostgresCategoriesRepository(app.db)),
  );
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const allowRead = requireBusinessRole(["owner", "admin", "operator"]);
  const allowWrite = requireBusinessRole(["owner", "admin"]);
  const readAuthorization = [requireUser, requireMembership, allowRead];
  const writeAuthorization = [requireUser, requireMembership, allowWrite];

  app.post<{ Params: CategoryBusinessParams; Body: CreateCategoryInput }>(
    "/businesses/:businessId/categories",
    { schema: createCategorySchema, preHandler: writeAuthorization },
    controller.create,
  );
  app.get<{ Params: CategoryBusinessParams; Querystring: CategoryListQuery }>(
    "/businesses/:businessId/categories",
    { schema: listCategoriesSchema, preHandler: readAuthorization },
    controller.list,
  );
  app.get<{ Params: CategoryIdParams }>(
    "/businesses/:businessId/categories/:categoryId",
    { schema: getCategorySchema, preHandler: readAuthorization },
    controller.getById,
  );
  app.patch<{ Params: CategoryIdParams; Body: UpdateCategoryInput }>(
    "/businesses/:businessId/categories/:categoryId",
    { schema: updateCategorySchema, preHandler: writeAuthorization },
    controller.update,
  );
};
