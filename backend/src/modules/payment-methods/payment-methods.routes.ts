import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser, requireBusinessMembership, requireBusinessRole } from "../auth/auth.middleware.js";
import { PaymentMethodsController, type PaymentMethodBusinessParams, type PaymentMethodParams } from "./payment-methods.controller.js";
import { createPaymentMethodSchema, deletePaymentMethodSchema, listPaymentMethodsSchema, updatePaymentMethodSchema } from "./payment-methods.schema.js";
import { PaymentMethodsService } from "./payment-methods.service.js";
import type { CreatePaymentMethodInput, PaymentMethodStatus, UpdatePaymentMethodInput } from "./payment-methods.types.js";

export const paymentMethodsRoutes: FastifyPluginAsync<{ service: PaymentMethodsService }> = async (app, options) => {
  const controller = new PaymentMethodsController(options.service);
  const read = [requireAuthenticatedUser(app.authService), requireBusinessMembership(app.membershipsRepository), requireBusinessRole(["owner", "admin", "operator"])];
  const write = [requireAuthenticatedUser(app.authService), requireBusinessMembership(app.membershipsRepository), requireBusinessRole(["owner", "admin"])];
  app.get<{ Params: PaymentMethodBusinessParams; Querystring: { status?: PaymentMethodStatus } }>("/businesses/:businessId/payment-methods", { schema: listPaymentMethodsSchema, preHandler: read }, controller.list);
  app.post<{ Params: PaymentMethodBusinessParams; Body: CreatePaymentMethodInput }>("/businesses/:businessId/payment-methods", { schema: createPaymentMethodSchema, preHandler: write }, controller.create);
  app.patch<{ Params: PaymentMethodParams; Body: UpdatePaymentMethodInput }>("/businesses/:businessId/payment-methods/:paymentMethodId", { schema: updatePaymentMethodSchema, preHandler: write }, controller.update);
  app.delete<{ Params: PaymentMethodParams }>("/businesses/:businessId/payment-methods/:paymentMethodId", { schema: deletePaymentMethodSchema, preHandler: write }, controller.delete);
};
