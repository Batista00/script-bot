import type { FastifyReply, FastifyRequest } from "fastify";

import { CategoriesService } from "./categories.service.js";
import type {
  CategoryListQuery,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./categories.types.js";

export interface CategoryBusinessParams {
  businessId: string;
}

export interface CategoryIdParams extends CategoryBusinessParams {
  categoryId: string;
}

export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  create = async (
    request: FastifyRequest<{ Params: CategoryBusinessParams; Body: CreateCategoryInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const category = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(category);
  };

  list = async (
    request: FastifyRequest<{ Params: CategoryBusinessParams; Querystring: CategoryListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const categories = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
    });
    return reply.status(200).send(categories);
  };

  getById = async (
    request: FastifyRequest<{ Params: CategoryIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const category = await this.service.getById(
      request.params.businessId,
      request.params.categoryId,
    );
    return reply.status(200).send(category);
  };

  update = async (
    request: FastifyRequest<{ Params: CategoryIdParams; Body: UpdateCategoryInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const category = await this.service.update(
      request.params.businessId,
      request.params.categoryId,
      request.body,
    );
    return reply.status(200).send(category);
  };
}
