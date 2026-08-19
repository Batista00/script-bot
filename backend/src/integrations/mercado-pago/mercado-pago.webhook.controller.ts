import type { FastifyReply, FastifyRequest } from "fastify";

import { MercadoPagoWebhookService } from "./mercado-pago.webhook.service.js";

export interface MercadoPagoWebhookParams { integrationId: string }
export interface MercadoPagoWebhookQuery { "data.id": string; type: string }
export interface MercadoPagoWebhookHeaders {
  "x-signature"?: string;
  "x-request-id"?: string;
}

export class MercadoPagoWebhookController {
  constructor(private readonly service: MercadoPagoWebhookService) {}

  process = async (
    request: FastifyRequest<{
      Params: MercadoPagoWebhookParams;
      Querystring: MercadoPagoWebhookQuery;
      Headers: MercadoPagoWebhookHeaders;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.process({
      integrationId: request.params.integrationId,
      type: request.query.type,
      dataId: request.query["data.id"],
      ...(request.headers["x-signature"] === undefined
        ? {}
        : { xSignature: request.headers["x-signature"] }),
      ...(request.headers["x-request-id"] === undefined
        ? {}
        : { xRequestId: request.headers["x-request-id"] }),
    });
    return reply.status(200).send({ status: "ok" });
  };
}
