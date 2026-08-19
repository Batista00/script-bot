import type { FastifyReply, FastifyRequest } from "fastify";

import { FulfillmentsService } from "./fulfillments.service.js";
import type {
  DispatchFulfillmentInput,
  FulfillmentListQuery,
} from "./fulfillments.types.js";

export interface FulfillmentBusinessParams { businessId: string }
export interface FulfillmentOrderParams { businessId: string; orderId: string }
export interface FulfillmentIdParams { businessId: string; fulfillmentId: string }

export class FulfillmentsController {
  constructor(private readonly service: FulfillmentsService) {}

  dispatch = async (
    request: FastifyRequest<{ Params: FulfillmentOrderParams; Body: DispatchFulfillmentInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const fulfillment = await this.service.dispatch(
      request.params.businessId,
      request.params.orderId,
      request.body,
    );
    return reply.status(201).send(fulfillment);
  };

  listByOrder = async (
    request: FastifyRequest<{ Params: FulfillmentOrderParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const fulfillments = await this.service.listByOrder(
      request.params.businessId,
      request.params.orderId,
    );
    return reply.status(200).send(fulfillments);
  };

  list = async (
    request: FastifyRequest<{
      Params: FulfillmentBusinessParams;
      Querystring: FulfillmentListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const fulfillments = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
    });
    return reply.status(200).send(fulfillments);
  };

  getById = async (
    request: FastifyRequest<{ Params: FulfillmentIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    return reply.status(200).send(await this.service.getById(
      request.params.businessId,
      request.params.fulfillmentId,
    ));
  };

  retry = async (
    request: FastifyRequest<{ Params: FulfillmentIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    return reply.status(200).send(await this.service.retry(
      request.params.businessId,
      request.params.fulfillmentId,
    ));
  };

  syncStatus = async (
    request: FastifyRequest<{ Params: FulfillmentIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    return reply.status(200).send(await this.service.syncStatus(
      request.params.businessId,
      request.params.fulfillmentId,
    ));
  };
}
