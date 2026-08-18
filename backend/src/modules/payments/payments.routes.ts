import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type IdempotencyHeaders,
  type PaymentBusinessParams,
  PaymentsController,
  type PaymentIdParams,
  type PaymentOrderParams,
} from "./payments.controller.js";
import { PaymentProviderRegistry } from "./payments.registry.js";
import { PostgresPaymentsRepository } from "./payments.repository.js";
import {
  createPaymentSchema,
  getPaymentSchema,
  listOrderPaymentsSchema,
  listPaymentsSchema,
} from "./payments.schema.js";
import { PaymentsService } from "./payments.service.js";
import type { CreatePaymentInput, PaymentListQuery } from "./payments.types.js";

export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  const controller = new PaymentsController(
    new PaymentsService(
      new PostgresPaymentsRepository(app.db),
      app.db,
      new PaymentProviderRegistry(),
    ),
  );
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin", "operator"]),
  ];

  app.post<{
    Params: PaymentOrderParams;
    Body: CreatePaymentInput;
    Headers: IdempotencyHeaders;
  }>(
    "/businesses/:businessId/orders/:orderId/payments",
    { schema: createPaymentSchema, preHandler: authorization },
    controller.create,
  );
  app.get<{ Params: PaymentBusinessParams; Querystring: PaymentListQuery }>(
    "/businesses/:businessId/payments",
    { schema: listPaymentsSchema, preHandler: authorization },
    controller.list,
  );
  app.get<{ Params: PaymentIdParams }>(
    "/businesses/:businessId/payments/:paymentId",
    { schema: getPaymentSchema, preHandler: authorization },
    controller.getById,
  );
  app.get<{
    Params: PaymentOrderParams;
    Querystring: Pick<PaymentListQuery, "limit" | "offset">;
  }>(
    "/businesses/:businessId/orders/:orderId/payments",
    { schema: listOrderPaymentsSchema, preHandler: authorization },
    controller.listByOrder,
  );
};
