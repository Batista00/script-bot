import type { FastifyPluginAsync } from "fastify";

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
  const service = new BusinessesService(repository);
  const controller = new BusinessesController(service);

  app.post<{ Body: CreateBusinessInput }>(
    "/",
    { schema: createBusinessSchema },
    controller.create,
  );
  app.get("/", { schema: listBusinessesSchema }, controller.list);
  app.get<{ Params: BusinessIdParams }>(
    "/:id",
    { schema: getBusinessSchema },
    controller.getById,
  );
  app.patch<{ Params: BusinessIdParams; Body: UpdateBusinessInput }>(
    "/:id",
    { schema: updateBusinessSchema },
    controller.update,
  );
};

