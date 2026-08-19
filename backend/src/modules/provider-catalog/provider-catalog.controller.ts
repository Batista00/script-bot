import type { FastifyReply, FastifyRequest } from "fastify";

import { ProviderCatalogService } from "./provider-catalog.service.js";
import type {
  CreateProductProviderMappingInput,
  ProviderServiceListQuery,
  UpdateProductProviderMappingInput,
} from "./provider-catalog.types.js";

export interface ProviderCatalogBusinessParams { businessId: string }
export interface ProviderServiceParams extends ProviderCatalogBusinessParams {
  providerServiceId: string;
}
export interface ProviderCatalogSyncParams extends ProviderCatalogBusinessParams {
  integrationId: string;
}
export interface ProductProviderMappingParams extends ProviderCatalogBusinessParams {
  productId: string;
}

export class ProviderCatalogController {
  constructor(private readonly service: ProviderCatalogService) {}

  listServices = async (
    request: FastifyRequest<{
      Params: ProviderCatalogBusinessParams;
      Querystring: ProviderServiceListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const services = await this.service.listServices(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.integrationId === undefined
        ? {} : { integrationId: request.query.integrationId }),
      ...(request.query.providerKey === undefined
        ? {} : { providerKey: request.query.providerKey }),
      ...(request.query.providerStatus === undefined
        ? {} : { providerStatus: request.query.providerStatus }),
      ...(request.query.category === undefined ? {} : { category: request.query.category }),
    });
    return reply.status(200).send(services);
  };

  getServiceById = async (
    request: FastifyRequest<{ Params: ProviderServiceParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const service = await this.service.getServiceById(
      request.params.businessId,
      request.params.providerServiceId,
    );
    return reply.status(200).send(service);
  };

  sync = async (
    request: FastifyRequest<{ Params: ProviderCatalogSyncParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const result = await this.service.sync(
      request.params.businessId,
      request.params.integrationId,
    );
    return reply.status(200).send(result);
  };

  createMapping = async (
    request: FastifyRequest<{
      Params: ProductProviderMappingParams;
      Body: CreateProductProviderMappingInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const mapping = await this.service.createMapping(
      request.params.businessId,
      request.params.productId,
      request.body,
    );
    return reply.status(201).send(mapping);
  };

  getMapping = async (
    request: FastifyRequest<{ Params: ProductProviderMappingParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const mapping = await this.service.getMapping(
      request.params.businessId,
      request.params.productId,
    );
    return reply.status(200).send(mapping);
  };

  updateMapping = async (
    request: FastifyRequest<{
      Params: ProductProviderMappingParams;
      Body: UpdateProductProviderMappingInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const mapping = await this.service.updateMapping(
      request.params.businessId,
      request.params.productId,
      request.body,
    );
    return reply.status(200).send(mapping);
  };
}
