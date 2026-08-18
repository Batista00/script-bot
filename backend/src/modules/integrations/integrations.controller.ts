import type { FastifyReply, FastifyRequest } from "fastify";

import { IntegrationsService } from "./integrations.service.js";
import type {
  CreateIntegrationInput,
  IntegrationListQuery,
  UpdateIntegrationInput,
} from "./integrations.types.js";

export interface IntegrationBusinessParams { businessId: string }
export interface IntegrationIdParams extends IntegrationBusinessParams {
  integrationId: string;
}

export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  create = async (
    request: FastifyRequest<{
      Params: IntegrationBusinessParams;
      Body: CreateIntegrationInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const integration = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(integration);
  };

  list = async (
    request: FastifyRequest<{
      Params: IntegrationBusinessParams;
      Querystring: IntegrationListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const integrations = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.providerKey === undefined
        ? {}
        : { providerKey: request.query.providerKey }),
    });
    return reply.status(200).send(integrations);
  };

  getById = async (
    request: FastifyRequest<{ Params: IntegrationIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const integration = await this.service.getById(
      request.params.businessId,
      request.params.integrationId,
    );
    return reply.status(200).send(integration);
  };

  update = async (
    request: FastifyRequest<{
      Params: IntegrationIdParams;
      Body: UpdateIntegrationInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const integration = await this.service.update(
      request.params.businessId,
      request.params.integrationId,
      request.body,
    );
    return reply.status(200).send(integration);
  };
}
