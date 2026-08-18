import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type OrderBusinessParams,
  OrdersController,
  type OrderIdParams,
} from "./orders.controller.js";
import { PostgresOrdersRepository } from "./orders.repository.js";
import {
  cancelOrderSchema,
  createOrderSchema,
  getOrderSchema,
  listOrdersSchema,
} from "./orders.schema.js";
import { OrdersService } from "./orders.service.js";
import type { CreateOrderInput, OrderListQuery } from "./orders.types.js";

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  const controller = new OrdersController(
    new OrdersService(new PostgresOrdersRepository(app.db), app.db),
  );
  const requireUser = requireAuthenticatedUser(app.authService);
  const requireMembership = requireBusinessMembership(app.membershipsRepository);
  const allowAllRoles = requireBusinessRole(["owner", "admin", "operator"]);
  const allowManagers = requireBusinessRole(["owner", "admin"]);
  const regularAuthorization = [requireUser, requireMembership, allowAllRoles];
  const cancelAuthorization = [requireUser, requireMembership, allowManagers];

  app.post<{ Params: OrderBusinessParams; Body: CreateOrderInput }>(
    "/businesses/:businessId/orders",
    { schema: createOrderSchema, preHandler: regularAuthorization },
    controller.create,
  );
  app.get<{ Params: OrderBusinessParams; Querystring: OrderListQuery }>(
    "/businesses/:businessId/orders",
    { schema: listOrdersSchema, preHandler: regularAuthorization },
    controller.list,
  );
  app.get<{ Params: OrderIdParams }>(
    "/businesses/:businessId/orders/:orderId",
    { schema: getOrderSchema, preHandler: regularAuthorization },
    controller.getById,
  );
  app.post<{ Params: OrderIdParams }>(
    "/businesses/:businessId/orders/:orderId/cancel",
    { schema: cancelOrderSchema, preHandler: cancelAuthorization },
    controller.cancel,
  );
};
