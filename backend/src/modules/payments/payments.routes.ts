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
import {
  createPaymentSchema,
  getPaymentSchema,
  listOrderPaymentsSchema,
  listPaymentsSchema,
} from "./payments.schema.js";
import { PaymentsService } from "./payments.service.js";
import type { CreatePaymentInput, PaymentListQuery } from "./payments.types.js";

interface PaymentsRoutesOptions { service: PaymentsService }

export const paymentsRoutes: FastifyPluginAsync<PaymentsRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new PaymentsController(options.service);
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
