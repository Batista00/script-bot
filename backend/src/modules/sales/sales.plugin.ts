import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { PaymentsService } from "../payments/payments.service.js";
import type { ProviderFulfillmentRegistry } from "../fulfillments/fulfillments.registry.js";
import { PostgresProviderCatalogRepository } from "../provider-catalog/provider-catalog.repository.js";
import { IntegrationCredentialsCrypto } from "../integrations/integrations.crypto.js";
import { PostgresApiCredentialsRepository } from "../api-credentials/api-credentials.repository.js";
import { MachineAuthService } from "../machine-auth/machine-auth.service.js";
import { PostgresNotificationsRepository } from "../automation/notifications.repository.js";
import { AutomationService } from "../automation/automation.service.js";
import { AutomationAccessService } from "../automation/automation-access.service.js";
import { AutomationController } from "../automation/automation.controller.js";
import { PostgresPaymentReviewsRepository } from "../payment-reviews/payment-reviews.repository.js";
import { PaymentReviewsService } from "../payment-reviews/payment-reviews.service.js";
import { TelegramService } from "../../integrations/telegram/telegram.service.js";
import { PostgresSalesRepository } from "./sales.repository.js";
import { SalesAccessService } from "./sales-access.service.js";
import { SalesDeliveryService } from "./sales-delivery.service.js";
import { SalesCheckoutService } from "./sales-checkout.service.js";
import { SalesConversationService } from "./sales-conversation.service.js";
import { SalesController } from "./sales.controller.js";
import { SalesAdminService } from "./sales-admin.service.js";
import { SalesAdminController } from "./sales-admin.controller.js";
import { SalesShippingQuoteService } from "./sales-shipping-quote.service.js";
import { salesRoutes } from "./sales.routes.js";
import { SalesInboxService } from "./sales-inbox.service.js";
import { PostgresSalesInboxRepository } from "./sales-inbox.repository.js";
import type { AiInterpreter } from "../ai-orchestrator/ai-orchestrator.types.js";
import { DigitalDeliveryService } from "../digital-delivery/digital-delivery.service.js";
import { PostgresDigitalDeliveryRepository } from "../digital-delivery/digital-delivery.repository.js";
import { digitalDeliveryRoutes } from "../digital-delivery/digital-delivery.routes.js";
import { ProductsService } from "../products/products.service.js";
import { PostgresProductsRepository } from "../products/products.repository.js";
import { PostgresCategoriesRepository } from "../categories/categories.repository.js";

export async function registerSalesAutomation(app:FastifyInstance,config:Env,gateway:BotGatewayService,
  integrations:IntegrationsService,payments:PaymentsService,adapters:ProviderFulfillmentRegistry,
  interpreter?:AiInterpreter) {
  const sales=new PostgresSalesRepository(app.db);
  const inbox=new SalesInboxService(new PostgresSalesInboxRepository(app.db),sales);
  const notifications=new PostgresNotificationsRepository(app.db);
  const reviewRepository=new PostgresPaymentReviewsRepository(app.db);
  const digital=new DigitalDeliveryService(new PostgresDigitalDeliveryRepository(app.db),
    new ProductsService(new PostgresProductsRepository(app.db),new PostgresCategoriesRepository(app.db)),
    gateway,new IntegrationCredentialsCrypto(config.INTEGRATIONS_ENCRYPTION_KEY),notifications);
  digitalDeliveryRoutes(app,digital);
  const delivery=new SalesDeliveryService(gateway,new PostgresProviderCatalogRepository(app.db),integrations,adapters,digital);
  const checkout=new SalesCheckoutService(sales,gateway,delivery,reviewRepository);
  const reviews=new PaymentReviewsService(reviewRepository,sales,checkout,payments,new IntegrationCredentialsCrypto(config.INTEGRATIONS_ENCRYPTION_KEY),notifications);
  const automation=new AutomationService(sales,gateway,delivery,notifications,reviews,digital);
  await app.register(salesRoutes,{
    controller:new SalesController(new SalesAccessService(sales,gateway),new SalesConversationService(sales,gateway,checkout,notifications,interpreter),reviews,inbox),
    admin:new SalesAdminController(new SalesAdminService(sales,reviewRepository,notifications,new PostgresSalesInboxRepository(app.db)),new SalesShippingQuoteService(sales,checkout,notifications)),
    automation:new AutomationController(automation,new AutomationAccessService(integrations),notifications,new TelegramService(integrations,reviews,sales),inbox),
    machineAuth:new MachineAuthService(new PostgresApiCredentialsRepository(app.db)),
  });
}
