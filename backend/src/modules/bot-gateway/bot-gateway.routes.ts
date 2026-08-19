import type { FastifyPluginAsync } from "fastify";

import { requireMachineCredential } from "../machine-auth/machine-auth.middleware.js";
import { MachineAuthService } from "../machine-auth/machine-auth.service.js";
import {
  type BotFulfillmentParams,
  BotGatewayController,
  type BotOrderParams,
  type BotPaymentParams,
  type BotProductParams,
} from "./bot-gateway.controller.js";
import {
  createBotOrderSchema,
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
  listBotProductsSchema,
  resolveCustomerSchema,
  syncBotFulfillmentSchema,
} from "./bot-gateway.schema.js";
import { BotGatewayService } from "./bot-gateway.service.js";
import type {
  BotCreateOrderInput,
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
}

export const botGatewayRoutes: FastifyPluginAsync<BotGatewayRoutesOptions> = async (
  app,
  options,
) => {
  app.decorateRequest("machineAuthContext", null);
  const controller = new BotGatewayController(options.service);
  const machineAuth = requireMachineCredential(options.machineAuth);

  app.post<{ Body: BotResolveCustomerInput }>(
    "/customers/resolve", { schema: resolveCustomerSchema, preHandler: machineAuth },
    controller.resolveCustomer,
  );
  app.get<{ Querystring: BotListQuery }>(
    "/categories", { schema: listBotCategoriesSchema, preHandler: machineAuth },
    controller.listCategories,
  );
  app.get<{ Querystring: BotProductListQuery }>(
    "/products", { schema: listBotProductsSchema, preHandler: machineAuth },
    controller.listProducts,
  );
  app.get<{ Params: BotProductParams }>(
    "/products/:productId", { schema: getBotProductSchema, preHandler: machineAuth },
    controller.getProduct,
  );
  app.get<{ Params: BotProductParams; Querystring: BotListQuery }>(
    "/products/:productId/prices", { schema: listBotPricesSchema, preHandler: machineAuth },
    controller.listPrices,
  );
  app.post<{ Body: BotCreateQuoteInput }>(
    "/quotes", { schema: createBotQuoteSchema, preHandler: machineAuth },
    controller.createQuote,
  );
  app.post<{ Body: BotCreateOrderInput }>(
    "/orders", { schema: createBotOrderSchema, preHandler: machineAuth },
    controller.createOrder,
  );
  app.get<{ Params: BotOrderParams }>(
    "/orders/:orderId", { schema: getBotOrderSchema, preHandler: machineAuth },
    controller.getOrder,
  );
  app.post<{
    Params: BotOrderParams; Body: BotCreatePaymentInput; Headers: BotIdempotencyHeaders;
  }>(
    "/orders/:orderId/payments", { schema: createBotPaymentSchema, preHandler: machineAuth },
    controller.createPayment,
  );
  app.get<{ Params: BotPaymentParams }>(
    "/payments/:paymentId", { schema: getBotPaymentSchema, preHandler: machineAuth },
    controller.getPayment,
  );
  app.post<{ Params: BotOrderParams; Body: BotDispatchFulfillmentInput }>(
    "/orders/:orderId/fulfillments",
    { schema: dispatchBotFulfillmentSchema, preHandler: machineAuth },
    controller.dispatchFulfillment,
  );
  app.get<{ Params: BotOrderParams }>(
    "/orders/:orderId/fulfillments",
    { schema: listBotFulfillmentsSchema, preHandler: machineAuth },
    controller.listFulfillments,
  );
  app.post<{ Params: BotFulfillmentParams }>(
    "/fulfillments/:fulfillmentId/sync-status",
    { schema: syncBotFulfillmentSchema, preHandler: machineAuth },
    controller.syncFulfillment,
  );
  app.get<{ Params: BotFulfillmentParams }>(
    "/fulfillments/:fulfillmentId",
    { schema: getBotFulfillmentSchema, preHandler: machineAuth },
    controller.getFulfillment,
  );
};
