import type { FastifyReply, FastifyRequest } from "fastify";

import { PricingService } from "./pricing.service.js";
import type {
  CreateProductPriceInput,
  ProductPriceListQuery,
  UpdateProductPriceInput,
} from "./pricing.types.js";

export interface PricingProductParams {
  businessId: string;
  productId: string;
}

export interface PriceIdParams extends PricingProductParams {
  priceId: string;
}

export class PricingController {
  constructor(private readonly service: PricingService) {}

  create = async (
    request: FastifyRequest<{ Params: PricingProductParams; Body: CreateProductPriceInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const price = await this.service.create(
      request.params.businessId,
      request.params.productId,
      request.body,
    );
    return reply.status(201).send(price);
  };

  list = async (
    request: FastifyRequest<{
      Params: PricingProductParams;
      Querystring: ProductPriceListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const prices = await this.service.list(request.params.businessId, request.params.productId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
    });
    return reply.status(200).send(prices);
  };

  getById = async (
    request: FastifyRequest<{ Params: PriceIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const price = await this.service.getById(
      request.params.businessId,
      request.params.productId,
      request.params.priceId,
    );
    return reply.status(200).send(price);
  };

  update = async (
    request: FastifyRequest<{ Params: PriceIdParams; Body: UpdateProductPriceInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const price = await this.service.update(
      request.params.businessId,
      request.params.productId,
      request.params.priceId,
      request.body,
    );
    return reply.status(200).send(price);
  };
}
