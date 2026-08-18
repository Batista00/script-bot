import type { FastifyReply, FastifyRequest } from "fastify";

import { CustomersService } from "./customers.service.js";
import type {
  CreateCustomerInput,
  CustomerListQuery,
  UpdateCustomerInput,
} from "./customers.types.js";

export interface CustomerBusinessParams {
  businessId: string;
}

export interface CustomerIdParams extends CustomerBusinessParams {
  customerId: string;
}

export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  create = async (
    request: FastifyRequest<{ Params: CustomerBusinessParams; Body: CreateCustomerInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const customer = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(customer);
  };

  list = async (
    request: FastifyRequest<{ Params: CustomerBusinessParams; Querystring: CustomerListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const customers = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.phone === undefined ? {} : { phone: request.query.phone }),
      ...(request.query.email === undefined ? {} : { email: request.query.email }),
    });
    return reply.status(200).send(customers);
  };

  getById = async (
    request: FastifyRequest<{ Params: CustomerIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const customer = await this.service.getById(
      request.params.businessId,
      request.params.customerId,
    );
    return reply.status(200).send(customer);
  };

  update = async (
    request: FastifyRequest<{ Params: CustomerIdParams; Body: UpdateCustomerInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const customer = await this.service.update(
      request.params.businessId,
      request.params.customerId,
      request.body,
    );
    return reply.status(200).send(customer);
  };
}
