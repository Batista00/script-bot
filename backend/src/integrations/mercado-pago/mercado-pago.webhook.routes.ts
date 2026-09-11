import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import {
  type MercadoPagoWebhookHeaders,
  MercadoPagoWebhookController,
  type MercadoPagoWebhookParams,
  type MercadoPagoWebhookQuery,
} from "./mercado-pago.webhook.controller.js";
import { mercadoPagoWebhookSchema } from "./mercado-pago.webhook.schema.js";
import type { MercadoPagoWebhookService } from "./mercado-pago.webhook.service.js";

interface MercadoPagoWebhookRoutesOptions {
  service: MercadoPagoWebhookService;
  /** Public endpoint: anonymous floods are throttled per client address. */
  rateLimit?: preHandlerHookHandler;
}

export const mercadoPagoWebhookRoutes: FastifyPluginAsync<
  MercadoPagoWebhookRoutesOptions
> = async (app, options) => {
  const controller = new MercadoPagoWebhookController(options.service);
  app.post<{
    Params: MercadoPagoWebhookParams;
    Querystring: MercadoPagoWebhookQuery;
    Headers: MercadoPagoWebhookHeaders;
  }>(
    "/webhooks/mercado-pago/:integrationId",
    {
      schema: mercadoPagoWebhookSchema,
      ...(options.rateLimit === undefined ? {} : { preHandler: options.rateLimit }),
    },
    controller.process,
  );
};
