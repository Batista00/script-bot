import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { requireActiveBusiness } from "../businesses/businesses.active.middleware.js";
import {
  type IdempotencyHeaders,
  type ConfirmBankTransferInput,
  type PaymentBusinessParams,
  PaymentsController,
  type PaymentIdParams,
  type PaymentIntegrationParams,
  type PaymentOrderParams,
} from "./payments.controller.js";
import {
  createPaymentSchema,
  confirmBankTransferSchema,
  getPaymentSchema,
  listOrderPaymentsSchema,
  listPaymentsSchema,
  testPaymentProviderConnectionSchema,
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
  const commercialAuthorization = [...authorization, requireActiveBusiness()];
  const commercialConfirmation = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin"]),
    requireActiveBusiness(),
  ];

  app.post<{
    Params: PaymentOrderParams;
    Body: CreatePaymentInput;
    Headers: IdempotencyHeaders;
  }>(
    "/businesses/:businessId/orders/:orderId/payments",
    { schema: createPaymentSchema, preHandler: commercialAuthorization },
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
  app.post<{ Params: PaymentIntegrationParams }>(
    "/businesses/:businessId/integrations/:integrationId/payment-provider/test-connection",
    { schema: testPaymentProviderConnectionSchema, preHandler: authorization },
    controller.testConnection,
  );
  app.post<{ Params: PaymentIdParams; Body: ConfirmBankTransferInput }>(
    "/businesses/:businessId/payments/:paymentId/confirm-bank-transfer",
    {
      schema: confirmBankTransferSchema,
      preHandler: commercialConfirmation,
    },
    controller.confirmBankTransfer,
  );
};
