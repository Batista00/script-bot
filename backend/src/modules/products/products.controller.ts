import type { FastifyReply, FastifyRequest } from "fastify";

import { ProductsService } from "./products.service.js";
import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
} from "./products.types.js";

export interface ProductBusinessParams {
  businessId: string;
}

export interface ProductIdParams extends ProductBusinessParams {
  productId: string;
}

export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  create = async (
    request: FastifyRequest<{ Params: ProductBusinessParams; Body: CreateProductInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const product = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(product);
  };

  list = async (
    request: FastifyRequest<{ Params: ProductBusinessParams; Querystring: ProductListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const products = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.type === undefined ? {} : { type: request.query.type }),
      ...(request.query.categoryId === undefined
        ? {}
        : { categoryId: request.query.categoryId }),
    });
    return reply.status(200).send(products);
  };

  getById = async (
    request: FastifyRequest<{ Params: ProductIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const product = await this.service.getById(
      request.params.businessId,
      request.params.productId,
    );
    return reply.status(200).send(product);
  };

  update = async (
    request: FastifyRequest<{ Params: ProductIdParams; Body: UpdateProductInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const product = await this.service.update(
      request.params.businessId,
      request.params.productId,
      request.body,
    );
    return reply.status(200).send(product);
  };
}
