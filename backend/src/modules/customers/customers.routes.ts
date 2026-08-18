import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type CustomerBusinessParams,
  CustomersController,
  type CustomerIdParams,
} from "./customers.controller.js";
import { PostgresCustomersRepository } from "./customers.repository.js";
import {
  createCustomerSchema,
  getCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
} from "./customers.schema.js";
import { CustomersService } from "./customers.service.js";
import type {
  CreateCustomerInput,
  CustomerListQuery,
  UpdateCustomerInput,
} from "./customers.types.js";

export const customersRoutes: FastifyPluginAsync = async (app) => {
  const repository = new PostgresCustomersRepository(app.db);
  const controller = new CustomersController(new CustomersService(repository));
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const requireCustomerRole = requireBusinessRole(["owner", "admin", "operator"]);
  const authorization = [requireUser, requireMembership, requireCustomerRole];

  app.post<{ Params: CustomerBusinessParams; Body: CreateCustomerInput }>(
    "/businesses/:businessId/customers",
    { schema: createCustomerSchema, preHandler: authorization },
    controller.create,
  );
  app.get<{ Params: CustomerBusinessParams; Querystring: CustomerListQuery }>(
    "/businesses/:businessId/customers",
    { schema: listCustomersSchema, preHandler: authorization },
    controller.list,
  );
  app.get<{ Params: CustomerIdParams }>(
    "/businesses/:businessId/customers/:customerId",
    { schema: getCustomerSchema, preHandler: authorization },
    controller.getById,
  );
  app.patch<{ Params: CustomerIdParams; Body: UpdateCustomerInput }>(
    "/businesses/:businessId/customers/:customerId",
    { schema: updateCustomerSchema, preHandler: authorization },
    controller.update,
  );
};
