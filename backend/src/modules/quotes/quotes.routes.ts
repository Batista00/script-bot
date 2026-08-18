import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { PostgresCustomersRepository } from "../customers/customers.repository.js";
import { PriceCalculatorService } from "../pricing/price-calculator.service.js";
import { PostgresPricingRepository } from "../pricing/pricing.repository.js";
import { PostgresProductsRepository } from "../products/products.repository.js";
import {
  type QuoteBusinessParams,
  QuotesController,
  type QuoteIdParams,
} from "./quotes.controller.js";
import { PostgresQuotesRepository } from "./quotes.repository.js";
import { createQuoteSchema, getQuoteSchema, listQuotesSchema } from "./quotes.schema.js";
import { QuotesService } from "./quotes.service.js";
import type { CreateQuoteInput, QuoteListQuery } from "./quotes.types.js";

export const quotesRoutes: FastifyPluginAsync = async (app) => {
  const products = new PostgresProductsRepository(app.db);
  const prices = new PostgresPricingRepository(app.db);
  const controller = new QuotesController(
    new QuotesService(
      new PostgresQuotesRepository(app.db),
      new PriceCalculatorService(products, prices),
      new PostgresCustomersRepository(app.db),
    ),
  );
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin", "operator"]),
  ];

  app.post<{ Params: QuoteBusinessParams; Body: CreateQuoteInput }>(
    "/businesses/:businessId/quotes",
    { schema: createQuoteSchema, preHandler: authorization },
    controller.create,
  );
  app.get<{ Params: QuoteBusinessParams; Querystring: QuoteListQuery }>(
    "/businesses/:businessId/quotes",
    { schema: listQuotesSchema, preHandler: authorization },
    controller.list,
  );
  app.get<{ Params: QuoteIdParams }>(
    "/businesses/:businessId/quotes/:quoteId",
    { schema: getQuoteSchema, preHandler: authorization },
    controller.getById,
  );
};
