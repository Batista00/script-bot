import type { FastifyReply, FastifyRequest } from "fastify";
import { PaymentMethodsService } from "./payment-methods.service.js";
import type { CreatePaymentMethodInput, PaymentMethodStatus, UpdatePaymentMethodInput } from "./payment-methods.types.js";

export interface PaymentMethodBusinessParams { businessId: string }
export interface PaymentMethodParams extends PaymentMethodBusinessParams { paymentMethodId: string }
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}
  create = async (request: FastifyRequest<{ Params: PaymentMethodBusinessParams; Body: CreatePaymentMethodInput }>, reply: FastifyReply) =>
    reply.status(201).send(await this.service.create(request.params.businessId, request.body));
  list = async (request: FastifyRequest<{ Params: PaymentMethodBusinessParams; Querystring: { status?: PaymentMethodStatus } }>, reply: FastifyReply) =>
    reply.status(200).send(await this.service.list(request.params.businessId, request.query.status));
  update = async (request: FastifyRequest<{ Params: PaymentMethodParams; Body: UpdatePaymentMethodInput }>, reply: FastifyReply) =>
    reply.status(200).send(await this.service.update(request.params.businessId, request.params.paymentMethodId, request.body));
  delete = async (request: FastifyRequest<{ Params: PaymentMethodParams }>, reply: FastifyReply) => {
    await this.service.delete(request.params.businessId, request.params.paymentMethodId);
    return reply.status(204).send();
  };
}
