import type { FastifyReply, FastifyRequest } from "fastify";

import { requireMachineContext } from "../machine-auth/machine-auth.fastify.js";
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

export interface BotProductParams { productId: string }
export interface BotOrderParams { orderId: string }
export interface BotPaymentParams { paymentId: string }
export interface BotFulfillmentParams { fulfillmentId: string }

export class BotGatewayController {
  constructor(private readonly service: BotGatewayService) {}

  private business(request: FastifyRequest): string {
    return requireMachineContext(request.machineAuthContext).businessId;
  }

  resolveCustomer = async (
    request: FastifyRequest<{ Body: BotResolveCustomerInput }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.resolveCustomer(
    this.business(request), request.body,
  ));

  listCategories = async (
    request: FastifyRequest<{ Querystring: BotListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listCategories(
    this.business(request), request.query,
  ));

  listProducts = async (
    request: FastifyRequest<{ Querystring: BotProductListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listProducts(
    this.business(request), request.query,
  ));

  getProduct = async (
    request: FastifyRequest<{ Params: BotProductParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.getProduct(
    this.business(request), request.params.productId,
  ));

  listPrices = async (
    request: FastifyRequest<{ Params: BotProductParams; Querystring: BotListQuery }>,
    reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listPrices(
    this.business(request), request.params.productId, request.query,
  ));

  createQuote = async (
    request: FastifyRequest<{ Body: BotCreateQuoteInput }>, reply: FastifyReply,
  ) => reply.status(201).send(await this.service.createQuote(
    this.business(request), request.body,
  ));

  createOrder = async (
    request: FastifyRequest<{ Body: BotCreateOrderInput }>, reply: FastifyReply,
  ) => reply.status(201).send(await this.service.createOrder(
    this.business(request), request.body,
  ));

  getOrder = async (
    request: FastifyRequest<{ Params: BotOrderParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.getOrder(
    this.business(request), request.params.orderId,
  ));

  createPayment = async (
    request: FastifyRequest<{
      Params: BotOrderParams; Body: BotCreatePaymentInput; Headers: BotIdempotencyHeaders;
    }>,
    reply: FastifyReply,
  ) => {
    const outcome = await this.service.createPayment(
      this.business(request), request.params.orderId, request.body.providerKey,
      request.headers["idempotency-key"],
    );
    return reply.status(outcome.created ? 201 : 200).send(outcome.payment);
  };

  getPayment = async (
    request: FastifyRequest<{ Params: BotPaymentParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.getPayment(
    this.business(request), request.params.paymentId,
  ));

  dispatchFulfillment = async (
    request: FastifyRequest<{ Params: BotOrderParams; Body: BotDispatchFulfillmentInput }>,
    reply: FastifyReply,
  ) => reply.status(201).send(await this.service.dispatchFulfillment(
    this.business(request), request.params.orderId, request.body,
  ));

  listFulfillments = async (
    request: FastifyRequest<{ Params: BotOrderParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listFulfillments(
    this.business(request), request.params.orderId,
  ));

  getFulfillment = async (
    request: FastifyRequest<{ Params: BotFulfillmentParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.getFulfillment(
    this.business(request), request.params.fulfillmentId,
  ));

  syncFulfillment = async (
    request: FastifyRequest<{ Params: BotFulfillmentParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.syncFulfillment(
    this.business(request), request.params.fulfillmentId,
  ));
}
