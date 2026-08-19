import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiCredentialsService } from "./api-credentials.service.js";
import type {
  CreateApiCredentialInput,
  UpdateApiCredentialInput,
} from "./api-credentials.types.js";

export interface ApiCredentialBusinessParams { businessId: string }
export interface ApiCredentialIdParams { businessId: string; credentialId: string }

export class ApiCredentialsController {
  constructor(private readonly service: ApiCredentialsService) {}

  create = async (
    request: FastifyRequest<{
      Params: ApiCredentialBusinessParams; Body: CreateApiCredentialInput;
    }>,
    reply: FastifyReply,
  ) => reply.status(201).send(await this.service.create(
    request.params.businessId, request.body,
  ));

  list = async (
    request: FastifyRequest<{ Params: ApiCredentialBusinessParams }>,
    reply: FastifyReply,
  ) => reply.status(200).send(await this.service.list(request.params.businessId));

  getById = async (
    request: FastifyRequest<{ Params: ApiCredentialIdParams }>,
    reply: FastifyReply,
  ) => reply.status(200).send(await this.service.getById(
    request.params.businessId, request.params.credentialId,
  ));

  update = async (
    request: FastifyRequest<{
      Params: ApiCredentialIdParams; Body: UpdateApiCredentialInput;
    }>,
    reply: FastifyReply,
  ) => reply.status(200).send(await this.service.update(
    request.params.businessId, request.params.credentialId, request.body,
  ));
}
