import type { FastifyReply, FastifyRequest } from "fastify";

import { PaymentsService } from "./payments.service.js";
import type { CreatePaymentInput, PaymentListQuery } from "./payments.types.js";

export interface PaymentBusinessParams { businessId: string }
export interface PaymentOrderParams extends PaymentBusinessParams { orderId: string }
export interface PaymentIdParams extends PaymentBusinessParams { paymentId: string }
export interface IdempotencyHeaders { "idempotency-key"?: string }

function pagination(query: Pick<PaymentListQuery, "limit" | "offset">) {
  return {
    limit: query.limit === undefined ? 50 : Number(query.limit),
    offset: query.offset === undefined ? 0 : Number(query.offset),
  };
}

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  create = async (
    request: FastifyRequest<{
      Params: PaymentOrderParams;
      Body: CreatePaymentInput;
      Headers: IdempotencyHeaders;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const result = await this.service.create(
      request.params.businessId,
      request.params.orderId,
      request.body.providerKey,
      request.headers["idempotency-key"],
    );
    return reply.status(result.created ? 201 : 200).send(result.payment);
  };

  list = async (
    request: FastifyRequest<{ Params: PaymentBusinessParams; Querystring: PaymentListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const payments = await this.service.list(request.params.businessId, {
      ...pagination(request.query),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.orderId === undefined ? {} : { orderId: request.query.orderId }),
      ...(request.query.providerKey === undefined
        ? {}
        : { providerKey: request.query.providerKey }),
    });
    return reply.status(200).send(payments);
  };

  getById = async (
    request: FastifyRequest<{ Params: PaymentIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const payment = await this.service.getById(
      request.params.businessId,
      request.params.paymentId,
    );
    return reply.status(200).send(payment);
  };

  listByOrder = async (
    request: FastifyRequest<{
      Params: PaymentOrderParams;
      Querystring: Pick<PaymentListQuery, "limit" | "offset">;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const payments = await this.service.listByOrder(
      request.params.businessId,
      request.params.orderId,
      pagination(request.query),
    );
    return reply.status(200).send(payments);
  };
}
