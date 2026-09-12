import Fastify, { type FastifyInstance } from "fastify";

import { type Env, resolveTrustProxy } from "./config/env.js";
import { AiOrchestratorService } from "./modules/ai-orchestrator/ai-orchestrator.service.js";
import { aiOrchestratorRoutes } from "./modules/ai-orchestrator/ai-orchestrator.routes.js";
import { OpenAiResponsesClient } from "./modules/ai-orchestrator/openai-responses.client.js";
import { databasePlugin } from "./core/database/database.plugin.js";
import { registerErrorHandler } from "./core/errors/error-handler.js";
import { createLoggerOptions } from "./core/logger/logger.js";
import { EvolutionAdapter } from "./integrations/evolution/evolution.adapter.js";
import { NativeEvolutionClient } from "./integrations/evolution/evolution.client.js";
import { NativeMercadoPagoClient } from "./integrations/mercado-pago/mercado-pago.client.js";
import { MercadoPagoPaymentProvider } from "./integrations/mercado-pago/mercado-pago.provider.js";
import { mercadoPagoWebhookRoutes } from "./integrations/mercado-pago/mercado-pago.webhook.routes.js";
import { MercadoPagoWebhookService } from "./integrations/mercado-pago/mercado-pago.webhook.service.js";
import { SmmRajaCatalogAdapter } from "./integrations/smm-raja/smm-raja.adapter.js";
import { NativeSmmRajaClient } from "./integrations/smm-raja/smm-raja.client.js";
import { SmmRajaFulfillmentAdapter } from "./integrations/smm-raja/smm-raja.fulfillment.adapter.js";
import { PostgresApiCredentialsRepository } from "./modules/api-credentials/api-credentials.repository.js";
import { apiCredentialsRoutes } from "./modules/api-credentials/api-credentials.routes.js";
import { ApiCredentialsService } from "./modules/api-credentials/api-credentials.service.js";
import {
  FixedWindowRateLimiter,
  rateLimitGuard,
} from "./core/rate-limit/fixed-window-rate-limiter.js";
import { authPlugin } from "./modules/auth/auth.plugin.js";
import {
  LoginRateLimiter,
  loginRateLimitDefaults,
  loginRateLimitGuard,
} from "./modules/auth/auth.login-rate-limit.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { businessesRoutes } from "./modules/businesses/businesses.routes.js";
import { PostgresBusinessesRepository } from "./modules/businesses/businesses.repository.js";
import { botGatewayRoutes } from "./modules/bot-gateway/bot-gateway.routes.js";
import { BotGatewayService } from "./modules/bot-gateway/bot-gateway.service.js";
import { PostgresCategoriesRepository } from "./modules/categories/categories.repository.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { CategoriesService } from "./modules/categories/categories.service.js";
import { PostgresCustomersRepository } from "./modules/customers/customers.repository.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { CustomersService } from "./modules/customers/customers.service.js";
import { PostgresFulfillmentsRepository } from "./modules/fulfillments/fulfillments.repository.js";
import { ProviderFulfillmentRegistry } from "./modules/fulfillments/fulfillments.registry.js";
import { fulfillmentsRoutes } from "./modules/fulfillments/fulfillments.routes.js";
import { FulfillmentsService } from "./modules/fulfillments/fulfillments.service.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { integrationsRoutes } from "./modules/integrations/integrations.routes.js";
import { IntegrationCredentialsCrypto } from "./modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "./modules/integrations/integrations.repository.js";
import { IntegrationsService } from "./modules/integrations/integrations.service.js";
import { PostgresJobsRepository } from "./modules/jobs/jobs.repository.js";
import { jobsRoutes } from "./modules/jobs/jobs.routes.js";
import { JobsService } from "./modules/jobs/jobs.service.js";
import { MachineAuthService } from "./modules/machine-auth/machine-auth.service.js";
import { PostgresMembershipsRepository } from "./modules/memberships/memberships.repository.js";
import { businessMembershipsRoutes } from "./modules/memberships/memberships.routes.js";
import { BusinessMembershipsService } from "./modules/memberships/memberships.service.js";
import { PostgresOrdersRepository } from "./modules/orders/orders.repository.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { OrdersService } from "./modules/orders/orders.service.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { PaymentProviderRegistry } from "./modules/payments/payments.registry.js";
import { PostgresPaymentsRepository } from "./modules/payments/payments.repository.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { BankTransferPaymentProvider } from "./modules/payments/bank-transfer.provider.js";
import { PostgresPaymentMethodsRepository } from "./modules/payment-methods/payment-methods.repository.js";
import { paymentMethodsRoutes } from "./modules/payment-methods/payment-methods.routes.js";
import { PaymentMethodsService } from "./modules/payment-methods/payment-methods.service.js";
import { PriceCalculatorService } from "./modules/pricing/price-calculator.service.js";
import { PostgresPricingRepository } from "./modules/pricing/pricing.repository.js";
import { pricingRoutes } from "./modules/pricing/pricing.routes.js";
import { PricingService } from "./modules/pricing/pricing.service.js";
import { PostgresProductsRepository } from "./modules/products/products.repository.js";
import { productsRoutes } from "./modules/products/products.routes.js";
import { ProductsService } from "./modules/products/products.service.js";
import { PostgresProviderCatalogRepository } from "./modules/provider-catalog/provider-catalog.repository.js";
import { ProviderCatalogRegistry } from "./modules/provider-catalog/provider-catalog.registry.js";
import { providerCatalogRoutes } from "./modules/provider-catalog/provider-catalog.routes.js";
import { ProviderCatalogService } from "./modules/provider-catalog/provider-catalog.service.js";
import { ProviderProductImportService } from "./modules/provider-catalog/provider-product-import.service.js";
import { PostgresQuotesRepository } from "./modules/quotes/quotes.repository.js";
import { quotesRoutes } from "./modules/quotes/quotes.routes.js";
import { QuotesService } from "./modules/quotes/quotes.service.js";
import { PostgresUsersRepository } from "./modules/users/users.repository.js";
import { PostgresWhatsappRepository } from "./modules/whatsapp/whatsapp.repository.js";
import { whatsappRoutes } from "./modules/whatsapp/whatsapp.routes.js";
import { WhatsappService } from "./modules/whatsapp/whatsapp.service.js";
import { WhatsappWebhookService } from "./modules/whatsapp/whatsapp.webhook.service.js";
import { registerSalesAutomation } from "./modules/sales/sales.plugin.js";
import { PostgresConversationRepository } from "./modules/conversation/conversation.repository.js";
import { ConversationService } from "./modules/conversation/conversation.service.js";
import { conversationRoutes } from "./modules/conversation/conversation.routes.js";

export async function buildApp(config: Env): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    trustProxy: resolveTrustProxy(config.TRUST_PROXY),
    ajv: {
      customOptions: {
        coerceTypes: false,
      },
    },
    logger: createLoggerOptions(config.LOG_LEVEL),
  });

  registerErrorHandler(app);

  // Public surfaces are throttled per identity: the login by client address,
  // the Bot Gateway by machine credential and the provider webhook by address.
  const webhookRateLimit = rateLimitGuard({
    limiter: new FixedWindowRateLimiter({
      max: config.WEBHOOK_RATE_LIMIT_MAX ?? 240,
      windowSeconds: config.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS ?? 60,
    }),
    key: (request) => (request.ip.length > 0 ? request.ip : "unknown"),
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Try again later.",
  });
  const botRateLimit = rateLimitGuard({
    limiter: new FixedWindowRateLimiter({
      max: config.BOT_RATE_LIMIT_MAX ?? 600,
      windowSeconds: config.BOT_RATE_LIMIT_WINDOW_SECONDS ?? 60,
    }),
    key: (request) => request.machineAuthContext?.credentialId ?? request.ip,
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Try again later.",
  });
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
  const paymentMethodsRepository = new PostgresPaymentMethodsRepository(app.db);
  const paymentMethodsService = new PaymentMethodsService(paymentMethodsRepository);
  const jobsService = new JobsService(new PostgresJobsRepository(app.db));
  const paymentsService = new PaymentsService(
    new PostgresPaymentsRepository(app.db),
    app.db,
    new PaymentProviderRegistry([mercadoPagoProvider, new BankTransferPaymentProvider()]),
    undefined,
    paymentMethodsRepository,
    jobsService,
    integrationsService,
  );
  const mercadoPagoWebhookService = new MercadoPagoWebhookService(
    integrationsService,
    paymentsService,
    mercadoPagoClient,
    (details) => app.log.warn(details, "Unsupported Mercado Pago payment status"),
  );
  const smmRajaClient = new NativeSmmRajaClient();
  const providerCatalogService = new ProviderCatalogService(
    new PostgresProviderCatalogRepository(app.db),
    app.db,
    integrationsService,
    new PostgresProductsRepository(app.db),
    new ProviderCatalogRegistry([
      new SmmRajaCatalogAdapter(integrationsService, smmRajaClient),
    ]),
    undefined,
    (failure) => app.log.warn(failure, "Provider catalog sync failed"),
  );
  const providerProductImportService = new ProviderProductImportService(
    app.db,
    new PostgresProviderCatalogRepository(app.db),
    new PostgresCategoriesRepository(app.db),
    new PostgresProductsRepository(app.db),
    new PostgresPricingRepository(app.db),
    new PostgresBusinessesRepository(app.db),
  );
  const fulfillmentService = new FulfillmentsService(
    new PostgresFulfillmentsRepository(app.db),
    app.db,
    new ProviderFulfillmentRegistry([
      new SmmRajaFulfillmentAdapter(integrationsService, smmRajaClient),
    ]),
    undefined,
    (details) => app.log.warn(details, "Unsupported provider fulfillment status"),
  );
  const apiCredentialsRepository = new PostgresApiCredentialsRepository(app.db);
  const apiCredentialsService = new ApiCredentialsService(apiCredentialsRepository);
  const machineAuthService = new MachineAuthService(apiCredentialsRepository);

  const aiInterpreter = new OpenAiResponsesClient({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL ?? "gpt-5.4-nano",
    timeoutMs: config.OPENAI_TIMEOUT_MS ?? 10_000,
  });
  const aiOrchestratorService = new AiOrchestratorService(aiInterpreter);
  const categoriesRepository = new PostgresCategoriesRepository(app.db);
  const customersRepository = new PostgresCustomersRepository(app.db);
  const productsRepository = new PostgresProductsRepository(app.db);
  const pricingRepository = new PostgresPricingRepository(app.db);
  const botGatewayService = new BotGatewayService(
    new CustomersService(customersRepository),
    new CategoriesService(categoriesRepository),
    new ProductsService(productsRepository, categoriesRepository),
    new PricingService(pricingRepository, productsRepository, new PostgresBusinessesRepository(app.db)),
    new QuotesService(
      new PostgresQuotesRepository(app.db),
      new PriceCalculatorService(productsRepository, pricingRepository),
      customersRepository,
    ),
    new OrdersService(new PostgresOrdersRepository(app.db), app.db),
    paymentsService,
    fulfillmentService,
    paymentMethodsService,
    new PostgresBusinessesRepository(app.db),
    jobsService,
  );
  const whatsappRepository = new PostgresWhatsappRepository(app.db);
  const whatsappService = new WhatsappService(
    whatsappRepository,
    integrationsService,
    new CustomersService(customersRepository),
    new EvolutionAdapter(integrationsService, new NativeEvolutionClient(), config.NODE_ENV),
  );
  const whatsappWebhookService = new WhatsappWebhookService(
    integrationsService,
    new CustomersService(customersRepository),
    whatsappRepository,
  );
  // El orquestador y las cotizaciones comparten el mismo pricing core: el
  // precio que ve el cliente en un botón es el que cobra la orden.
  const conversationPricing = new PriceCalculatorService(productsRepository, pricingRepository);
  const conversationService = new ConversationService({
    repository: new PostgresConversationRepository(app.db),
    customers: new CustomersService(customersRepository),
    quotes: new QuotesService(
      new PostgresQuotesRepository(app.db),
      conversationPricing,
      customersRepository,
    ),
    orders: new OrdersService(new PostgresOrdersRepository(app.db), app.db),
    payments: paymentsService,
    paymentMethods: paymentMethodsService,
    pricing: conversationPricing,
    ai: {
      // La IA conversa; nunca decide categoría, producto, cantidad ni pago.
      reply: async ({ businessId, message, customerId, conversationId, context }) => {
        const answer = await aiOrchestratorService.handle(businessId, {
          message,
          customerId,
          conversationId,
          context,
        });
        if (!answer.message) return null;
        return { message: answer.message, action: answer.action };
      },
    },
  });
  await app.register(healthRoutes);
  await app.register(mercadoPagoWebhookRoutes, {
    service: mercadoPagoWebhookService,
    rateLimit: webhookRateLimit,
  });
  await app.register(integrationsRoutes, { service: integrationsService });
  const loginRateLimiter = new LoginRateLimiter({
    max: config.AUTH_LOGIN_RATE_LIMIT_MAX ?? loginRateLimitDefaults.max,
    windowSeconds:
      config.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS ?? loginRateLimitDefaults.windowSeconds,
  });
  await app.register(authRoutes, {
    prefix: "/auth",
    config,
    loginRateLimit: loginRateLimitGuard(loginRateLimiter),
  });
  await app.register(businessesRoutes, { prefix: "/businesses" });
  await app.register(businessMembershipsRoutes, {
    service: new BusinessMembershipsService(
      new PostgresMembershipsRepository(app.db),
      new PostgresUsersRepository(app.db),
      app.db,
    ),
  });
  await app.register(apiCredentialsRoutes, { service: apiCredentialsService });
  await app.register(botGatewayRoutes, {
    prefix: "/bot/v1",
    service: botGatewayService,
    machineAuth: machineAuthService,
    rateLimit: botRateLimit,
  });
  await app.register(aiOrchestratorRoutes, {
    prefix: "/bot/v1/assistant",
    service: aiOrchestratorService,
    machineAuth: machineAuthService,
  });
  await app.register(customersRoutes);
  await app.register(whatsappRoutes, {
    service: whatsappService,
    webhookService: whatsappWebhookService,
    rateLimit: webhookRateLimit,
  });
  await app.register(categoriesRoutes);
  await app.register(productsRoutes);
  await app.register(providerCatalogRoutes, {
    service: providerCatalogService,
    importService: providerProductImportService,
  });
  await app.register(fulfillmentsRoutes, { service: fulfillmentService });
  await app.register(pricingRoutes);
  await app.register(quotesRoutes);
  await app.register(ordersRoutes);
  await app.register(paymentsRoutes, { service: paymentsService });
  await app.register(paymentMethodsRoutes, { service: paymentMethodsService });
  await app.register(jobsRoutes, { service: jobsService });
  await app.register(conversationRoutes, {
    prefix: "/bot/v1",
    service: conversationService,
    machineAuth: machineAuthService,
  });
  await registerSalesAutomation(app, config, botGatewayService, integrationsService, paymentsService,
    new ProviderFulfillmentRegistry([new SmmRajaFulfillmentAdapter(integrationsService, smmRajaClient)]));

  return app;
}
