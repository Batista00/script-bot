import type { FastifyReply, FastifyRequest } from "fastify";

import { OrdersService } from "./orders.service.js";
import type { CreateOrderInput, OrderListQuery } from "./orders.types.js";

export interface OrderBusinessParams { businessId: string }
export interface OrderIdParams extends OrderBusinessParams { orderId: string }

export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  create = async (
    request: FastifyRequest<{ Params: OrderBusinessParams; Body: CreateOrderInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const order = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(order);
  };

  list = async (
    request: FastifyRequest<{ Params: OrderBusinessParams; Querystring: OrderListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const orders = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.customerId === undefined
        ? {}
        : { customerId: request.query.customerId }),
    });
    return reply.status(200).send(orders);
  };

  getById = async (
    request: FastifyRequest<{ Params: OrderIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const order = await this.service.getById(
      request.params.businessId,
      request.params.orderId,
    );
    return reply.status(200).send(order);
  };

  cancel = async (
    request: FastifyRequest<{ Params: OrderIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const order = await this.service.cancel(
      request.params.businessId,
      request.params.orderId,
    );
    return reply.status(200).send(order);
  };
}
