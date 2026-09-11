import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import { requireActiveBusiness } from "../businesses/businesses.active.middleware.js";
import { requireMachineCredential } from "../machine-auth/machine-auth.middleware.js";
import { MachineAuthService } from "../machine-auth/machine-auth.service.js";
import {
  type BotFulfillmentParams,
  BotGatewayController,
  type BotJobParams,
  type BotOrderParams,
  type BotPaymentParams,
  type BotProductParams,
} from "./bot-gateway.controller.js";
import {
  createBotOrderSchema,
  listBotJobsSchema,
  listBotOperationFulfillmentsSchema,
  listBotOrdersSchema,
  listBotPaymentsSchema,
  retryBotJobSchema,
  createBotPaymentSchema,
  createBotQuoteSchema,
  dispatchBotFulfillmentSchema,
  getBotFulfillmentSchema,
  getBotOrderSchema,
  getBotPaymentSchema,
  getBotProductSchema,
  listBotCategoriesSchema,
  listBotFulfillmentsSchema,
  listBotPricesSchema,
  listBotPaymentMethodsSchema,
  listBotProductsSchema,
  resolveCustomerSchema,
  syncBotFulfillmentSchema,
} from "./bot-gateway.schema.js";
import { BotGatewayService } from "./bot-gateway.service.js";
import type {
  BotCreateOrderInput,
  BotFulfillmentListQuery,
  BotJobListQuery,
  BotOrderListQuery,
  BotPaymentListQuery,
  BotCreatePaymentInput,
  BotCreateQuoteInput,
  BotDispatchFulfillmentInput,
  BotIdempotencyHeaders,
  BotListQuery,
  BotProductListQuery,
  BotResolveCustomerInput,
} from "./bot-gateway.types.js";

interface BotGatewayRoutesOptions {
  service: BotGatewayService;
  machineAuth: MachineAuthService;
  /** Applied per machine credential after successful authentication. */
  rateLimit?: preHandlerHookHandler;
}

export const botGatewayRoutes: FastifyPluginAsync<BotGatewayRoutesOptions> = async (
  app,
  options,
) => {
  app.decorateRequest("machineAuthContext", null);
  const controller = new BotGatewayController(options.service);
  const machineAuth = requireMachineCredential(options.machineAuth);
  const activeBusiness = requireActiveBusiness();
  const commercialAuthorization: preHandlerHookHandler[] = [machineAuth];
  if (options.rateLimit) commercialAuthorization.push(options.rateLimit);
  commercialAuthorization.push(activeBusiness);

  app.post<{ Body: BotResolveCustomerInput }>(
    "/customers/resolve", { schema: resolveCustomerSchema, preHandler: commercialAuthorization },
    controller.resolveCustomer,
  );
  app.get<{ Querystring: BotListQuery }>(
    "/categories", { schema: listBotCategoriesSchema, preHandler: commercialAuthorization },
    controller.listCategories,
  );
  app.get<{ Querystring: BotProductListQuery }>(
    "/products", { schema: listBotProductsSchema, preHandler: commercialAuthorization },
    controller.listProducts,
  );
  app.get<{ Params: BotProductParams }>(
    "/products/:productId", { schema: getBotProductSchema, preHandler: commercialAuthorization },
    controller.getProduct,
  );
  app.get<{ Params: BotProductParams; Querystring: BotListQuery }>(
    "/products/:productId/prices", { schema: listBotPricesSchema, preHandler: commercialAuthorization },
    controller.listPrices,
  );
  app.post<{ Body: BotCreateQuoteInput }>(
    "/quotes", { schema: createBotQuoteSchema, preHandler: commercialAuthorization },
    controller.createQuote,
  );
  app.post<{ Body: BotCreateOrderInput }>(
    "/orders", { schema: createBotOrderSchema, preHandler: commercialAuthorization },
    controller.createOrder,
  );
  app.get<{ Params: BotOrderParams }>(
    "/orders/:orderId", { schema: getBotOrderSchema, preHandler: commercialAuthorization },
    controller.getOrder,
  );
  app.post<{
    Params: BotOrderParams; Body: BotCreatePaymentInput; Headers: BotIdempotencyHeaders;
  }>(
    "/orders/:orderId/payments", { schema: createBotPaymentSchema, preHandler: commercialAuthorization },
    controller.createPayment,
  );
  app.get(
    "/payment-methods", { schema: listBotPaymentMethodsSchema, preHandler: commercialAuthorization },
    controller.listPaymentMethods,
  );
  app.get<{ Params: BotPaymentParams }>(
    "/payments/:paymentId", { schema: getBotPaymentSchema, preHandler: commercialAuthorization },
    controller.getPayment,
  );
  app.post<{ Params: BotOrderParams; Body: BotDispatchFulfillmentInput }>(
    "/orders/:orderId/fulfillments",
    { schema: dispatchBotFulfillmentSchema, preHandler: commercialAuthorization },
    controller.dispatchFulfillment,
  );
  app.get<{ Params: BotOrderParams }>(
    "/orders/:orderId/fulfillments",
    { schema: listBotFulfillmentsSchema, preHandler: commercialAuthorization },
    controller.listFulfillments,
  );
  app.post<{ Params: BotFulfillmentParams }>(
    "/fulfillments/:fulfillmentId/sync-status",
    { schema: syncBotFulfillmentSchema, preHandler: commercialAuthorization },
    controller.syncFulfillment,
  );

  // Operational views for automation (n8n) and dashboards. Machine
  // authenticated and scoped to the credential's business; they stay available
  // while the business is suspended so operators can react.
  const operations = [machineAuth, ...(options.rateLimit ? [options.rateLimit] : [])];
  app.get<{ Querystring: BotOrderListQuery }>(
    "/operations/orders", { schema: listBotOrdersSchema, preHandler: operations },
    controller.listOrders,
  );
  app.get<{ Querystring: BotPaymentListQuery }>(
    "/operations/payments", { schema: listBotPaymentsSchema, preHandler: operations },
    controller.listPayments,
  );
  app.get<{ Querystring: BotFulfillmentListQuery }>(
    "/operations/fulfillments", { schema: listBotOperationFulfillmentsSchema, preHandler: operations },
    controller.listFulfillmentsByStatus,
  );
  app.get<{ Querystring: BotJobListQuery }>(
    "/operations/jobs", { schema: listBotJobsSchema, preHandler: operations },
    controller.listJobs,
  );
  app.post<{ Params: BotJobParams }>(
    "/operations/jobs/:jobId/retry", { schema: retryBotJobSchema, preHandler: operations },
    controller.retryJob,
  );
  app.get<{ Params: BotFulfillmentParams }>(
    "/fulfillments/:fulfillmentId",
    { schema: getBotFulfillmentSchema, preHandler: commercialAuthorization },
    controller.getFulfillment,
  );
};
