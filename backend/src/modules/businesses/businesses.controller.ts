import type { FastifyReply, FastifyRequest } from "fastify";

import { BusinessesService } from "./businesses.service.js";
import type { CreateBusinessInput, UpdateBusinessInput } from "./businesses.types.js";

interface BusinessIdParams {
  id: string;
}

export class BusinessesController {
  constructor(private readonly service: BusinessesService) {}

  create = async (
    request: FastifyRequest<{ Body: CreateBusinessInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const user = request.authenticatedUser;
    if (!user) throw new Error("Authenticated user is missing after auth guard");
    const business = await this.service.create(request.body, user.id);
    return reply.status(201).send(business);
  };

  list = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const user = request.authenticatedUser;
    if (!user) throw new Error("Authenticated user is missing after auth guard");
    const businesses = await this.service.list(user.id);
    return reply.status(200).send(businesses);
  };

  getById = async (
    request: FastifyRequest<{ Params: BusinessIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const business = await this.service.getById(request.params.id);
    return reply.status(200).send(business);
  };

  update = async (
    request: FastifyRequest<{ Params: BusinessIdParams; Body: UpdateBusinessInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const business = await this.service.update(request.params.id, request.body);
    return reply.status(200).send(business);
  };
}
