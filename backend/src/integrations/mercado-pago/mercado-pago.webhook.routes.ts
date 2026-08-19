import type { FastifyPluginAsync } from "fastify";

import {
  type MercadoPagoWebhookHeaders,
  MercadoPagoWebhookController,
  type MercadoPagoWebhookParams,
  type MercadoPagoWebhookQuery,
} from "./mercado-pago.webhook.controller.js";
import { mercadoPagoWebhookSchema } from "./mercado-pago.webhook.schema.js";
import type { MercadoPagoWebhookService } from "./mercado-pago.webhook.service.js";

interface MercadoPagoWebhookRoutesOptions { service: MercadoPagoWebhookService }

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
    { schema: mercadoPagoWebhookSchema },
    controller.process,
  );
};
