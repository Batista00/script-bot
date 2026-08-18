import type { FastifyReply, FastifyRequest } from "fastify";

import { QuotesService } from "./quotes.service.js";
import type { CreateQuoteInput, QuoteListQuery } from "./quotes.types.js";

export interface QuoteBusinessParams {
  businessId: string;
}

export interface QuoteIdParams extends QuoteBusinessParams {
  quoteId: string;
}

export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  create = async (
    request: FastifyRequest<{ Params: QuoteBusinessParams; Body: CreateQuoteInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const quote = await this.service.create(request.params.businessId, request.body);
    return reply.status(201).send(quote);
  };

  list = async (
    request: FastifyRequest<{ Params: QuoteBusinessParams; Querystring: QuoteListQuery }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const quotes = await this.service.list(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(request.query.customerId === undefined
        ? {}
        : { customerId: request.query.customerId }),
      ...(request.query.productId === undefined
        ? {}
        : { productId: request.query.productId }),
    });
    return reply.status(200).send(quotes);
  };

  getById = async (
    request: FastifyRequest<{ Params: QuoteIdParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const quote = await this.service.getById(
      request.params.businessId,
      request.params.quoteId,
    );
    return reply.status(200).send(quote);
  };
}
