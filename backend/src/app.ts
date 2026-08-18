import Fastify, { type FastifyInstance } from "fastify";

import type { Env } from "./config/env.js";
import { databasePlugin } from "./core/database/database.plugin.js";
import { registerErrorHandler } from "./core/errors/error-handler.js";
import { createLoggerOptions } from "./core/logger/logger.js";
import { authPlugin } from "./modules/auth/auth.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { businessesRoutes } from "./modules/businesses/businesses.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { pricingRoutes } from "./modules/pricing/pricing.routes.js";
import { productsRoutes } from "./modules/products/products.routes.js";
import { quotesRoutes } from "./modules/quotes/quotes.routes.js";

export async function buildApp(config: Env): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    ajv: {
      customOptions: {
        coerceTypes: false,
      },
    },
    logger: createLoggerOptions(config.LOG_LEVEL),
  });

  registerErrorHandler(app);
  await app.register(databasePlugin, {
    connectionString: config.DATABASE_URL,
  });
  await app.register(authPlugin, { config });
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/auth", config });
  await app.register(businessesRoutes, { prefix: "/businesses" });
  await app.register(customersRoutes);
  await app.register(categoriesRoutes);
  await app.register(productsRoutes);
  await app.register(pricingRoutes);
  await app.register(quotesRoutes);
  await app.register(ordersRoutes);
  await app.register(paymentsRoutes);

  return app;
}
