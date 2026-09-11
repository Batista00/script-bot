import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../core/errors/app-error.js";
import type { JsonObject } from "../integrations/integrations.types.js";

import { requireMachineContext } from "../machine-auth/machine-auth.fastify.js";
import { BotGatewayService } from "./bot-gateway.service.js";
import type {
  BotCatalogPackagesQuery,
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

export interface BotProductParams { productId: string }
export interface BotOrderParams { orderId: string }
export interface BotPaymentParams { paymentId: string }
export interface BotFulfillmentParams { fulfillmentId: string }
export interface BotJobParams { jobId: string }

/**
 * El canal conversacional envía `fulfillmentInput` como cadena JSON porque sus
 * variables se serializan como texto. Se acepta también el objeto ya tipado y
 * cualquier otra forma se rechaza con un error de dominio explícito.
 */
export function normalizeFulfillmentInput(
  value: Record<string, unknown> | string | undefined,
): JsonObject | undefined {
  if (value === undefined) return undefined;
  // El schema ya limita el objeto a valores JSON escalares.
  if (typeof value !== "string") return value as JsonObject;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new AppError(
      "fulfillmentInput must be a JSON object", 400, "INVALID_FULFILLMENT_INPUT",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "fulfillmentInput must be a JSON object", 400, "INVALID_FULFILLMENT_INPUT",
    );
  }
  return parsed as JsonObject;
}

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

  listCatalogPackages = async (
    request: FastifyRequest<{ Querystring: BotCatalogPackagesQuery }>,
    reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listCatalogPackages(
    this.business(request),
    request.query.categoryId,
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
  ) => {
    const { fulfillmentInput, ...rest } = request.body;
    const normalized = normalizeFulfillmentInput(fulfillmentInput);
    return reply.status(201).send(await this.service.createOrder(
      this.business(request),
      normalized === undefined ? rest : { ...rest, fulfillmentInput: normalized },
    ));
  };

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
      this.business(request), request.params.orderId, request.body,
      request.headers["idempotency-key"],
    );
    return reply.status(outcome.created ? 201 : 200).send(outcome.payment);
  };

  listPaymentMethods = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.status(200).send(await this.service.listPaymentMethods(this.business(request)));

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

  listOrders = async (
    request: FastifyRequest<{ Querystring: BotOrderListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listOrders(
    this.business(request), request.query,
  ));

  listPayments = async (
    request: FastifyRequest<{ Querystring: BotPaymentListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listPayments(
    this.business(request), request.query,
  ));

  listFulfillmentsByStatus = async (
    request: FastifyRequest<{ Querystring: BotFulfillmentListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listFulfillmentsByStatus(
    this.business(request), request.query,
  ));

  listJobs = async (
    request: FastifyRequest<{ Querystring: BotJobListQuery }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.listJobs(
    this.business(request), request.query,
  ));

  retryJob = async (
    request: FastifyRequest<{ Params: BotJobParams }>, reply: FastifyReply,
  ) => reply.status(200).send(await this.service.retryJob(
    this.business(request), request.params.jobId,
  ));
}
