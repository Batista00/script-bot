import Fastify, { type FastifyInstance } from "fastify";

import type { Env } from "./config/env.js";
import { databasePlugin } from "./core/database/database.plugin.js";
import { registerErrorHandler } from "./core/errors/error-handler.js";
import { createLoggerOptions } from "./core/logger/logger.js";
import { businessesRoutes } from "./modules/businesses/businesses.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";

export async function buildApp(config: Env): Promise<FastifyInstance> {
  const app = Fastify({
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
  await app.register(healthRoutes);
  await app.register(businessesRoutes, { prefix: "/businesses" });

  return app;
}
