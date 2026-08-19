import Fastify, { type FastifyInstance } from "fastify";

import type { Env } from "./config/env.js";
import { databasePlugin } from "./core/database/database.plugin.js";
import { registerErrorHandler } from "./core/errors/error-handler.js";
import { createLoggerOptions } from "./core/logger/logger.js";
import { NativeMercadoPagoClient } from "./integrations/mercado-pago/mercado-pago.client.js";
import { MercadoPagoPaymentProvider } from "./integrations/mercado-pago/mercado-pago.provider.js";
import { mercadoPagoWebhookRoutes } from "./integrations/mercado-pago/mercado-pago.webhook.routes.js";
import { MercadoPagoWebhookService } from "./integrations/mercado-pago/mercado-pago.webhook.service.js";
import { authPlugin } from "./modules/auth/auth.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { businessesRoutes } from "./modules/businesses/businesses.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { integrationsRoutes } from "./modules/integrations/integrations.routes.js";
import { IntegrationCredentialsCrypto } from "./modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "./modules/integrations/integrations.repository.js";
import { IntegrationsService } from "./modules/integrations/integrations.service.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { PaymentProviderRegistry } from "./modules/payments/payments.registry.js";
import { PostgresPaymentsRepository } from "./modules/payments/payments.repository.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
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
  const integrationsService = new IntegrationsService(
    new PostgresIntegrationsRepository(app.db),
    new IntegrationCredentialsCrypto(config.INTEGRATIONS_ENCRYPTION_KEY),
  );
  const mercadoPagoClient = new NativeMercadoPagoClient();
  const mercadoPagoProvider = new MercadoPagoPaymentProvider(
    integrationsService,
    mercadoPagoClient,
    config.PUBLIC_API_BASE_URL,
    config.NODE_ENV,
  );
  const paymentsService = new PaymentsService(
    new PostgresPaymentsRepository(app.db),
    app.db,
    new PaymentProviderRegistry([mercadoPagoProvider]),
  );
  const mercadoPagoWebhookService = new MercadoPagoWebhookService(
    integrationsService,
    paymentsService,
    mercadoPagoClient,
    (details) => app.log.warn(details, "Unsupported Mercado Pago payment status"),
  );
  await app.register(healthRoutes);
  await app.register(mercadoPagoWebhookRoutes, { service: mercadoPagoWebhookService });
  await app.register(integrationsRoutes, { service: integrationsService });
  await app.register(authRoutes, { prefix: "/auth", config });
  await app.register(businessesRoutes, { prefix: "/businesses" });
  await app.register(customersRoutes);
  await app.register(categoriesRoutes);
  await app.register(productsRoutes);
  await app.register(pricingRoutes);
  await app.register(quotesRoutes);
  await app.register(ordersRoutes);
  await app.register(paymentsRoutes, { service: paymentsService });

  return app;
}
