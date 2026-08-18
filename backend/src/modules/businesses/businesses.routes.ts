import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { BusinessesController } from "./businesses.controller.js";
import { PostgresBusinessesRepository } from "./businesses.repository.js";
import {
  createBusinessSchema,
  getBusinessSchema,
  listBusinessesSchema,
  updateBusinessSchema,
} from "./businesses.schema.js";
import { BusinessesService } from "./businesses.service.js";
import type { CreateBusinessInput, UpdateBusinessInput } from "./businesses.types.js";

interface BusinessIdParams {
  id: string;
}

export const businessesRoutes: FastifyPluginAsync = async (app) => {
  const repository = new PostgresBusinessesRepository(app.db);
  const service = new BusinessesService(repository, app.membershipsRepository, app.db);
  const controller = new BusinessesController(service);
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const requireManager = requireBusinessRole(["owner", "admin"]);

  app.post<{ Body: CreateBusinessInput }>(
    "/",
    { schema: createBusinessSchema, preHandler: requireUser },
    controller.create,
  );
  app.get("/", { schema: listBusinessesSchema, preHandler: requireUser }, controller.list);
  app.get<{ Params: BusinessIdParams }>(
    "/:id",
    { schema: getBusinessSchema, preHandler: [requireUser, requireMembership] },
    controller.getById,
  );
  app.patch<{ Params: BusinessIdParams; Body: UpdateBusinessInput }>(
    "/:id",
    {
      schema: updateBusinessSchema,
      preHandler: [requireUser, requireMembership, requireManager],
    },
    controller.update,
  );
};
