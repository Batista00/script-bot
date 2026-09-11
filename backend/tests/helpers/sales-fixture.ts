import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { BotGatewayService } from "../../src/modules/bot-gateway/bot-gateway.service.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { PostgresCustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";
import { PostgresCategoriesRepository } from "../../src/modules/categories/categories.repository.js";
import { CategoriesService } from "../../src/modules/categories/categories.service.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { ProductsService } from "../../src/modules/products/products.service.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import { PricingService } from "../../src/modules/pricing/pricing.service.js";
import { PriceCalculatorService } from "../../src/modules/pricing/price-calculator.service.js";
import { PostgresQuotesRepository } from "../../src/modules/quotes/quotes.repository.js";
import { QuotesService } from "../../src/modules/quotes/quotes.service.js";
import { PostgresOrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";
import { PostgresPaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import { PaymentProviderRegistry } from "../../src/modules/payments/payments.registry.js";
import { BankTransferPaymentProvider } from "../../src/modules/payments/bank-transfer.provider.js";
import { PostgresPaymentMethodsRepository } from "../../src/modules/payment-methods/payment-methods.repository.js";
import { PaymentMethodsService } from "../../src/modules/payment-methods/payment-methods.service.js";
import { PostgresIntegrationsRepository } from "../../src/modules/integrations/integrations.repository.js";
import { IntegrationsService } from "../../src/modules/integrations/integrations.service.js";
import { IntegrationCredentialsCrypto } from "../../src/modules/integrations/integrations.crypto.js";
import { PostgresProviderCatalogRepository } from "../../src/modules/provider-catalog/provider-catalog.repository.js";
import { PostgresFulfillmentsRepository } from "../../src/modules/fulfillments/fulfillments.repository.js";
import { FulfillmentsService } from "../../src/modules/fulfillments/fulfillments.service.js";
import { ProviderFulfillmentRegistry } from "../../src/modules/fulfillments/fulfillments.registry.js";
import type { ProviderFulfillmentAdapter } from "../../src/modules/fulfillments/fulfillments.adapter.js";
import { PostgresSalesRepository } from "../../src/modules/sales/sales.repository.js";
import { PostgresSalesInboxRepository } from "../../src/modules/sales/sales-inbox.repository.js";
import { SalesInboxService } from "../../src/modules/sales/sales-inbox.service.js";
import { SalesAccessService } from "../../src/modules/sales/sales-access.service.js";
import { SalesDeliveryService } from "../../src/modules/sales/sales-delivery.service.js";
import { SalesCheckoutService } from "../../src/modules/sales/sales-checkout.service.js";
import { SalesConversationService } from "../../src/modules/sales/sales-conversation.service.js";
import { PostgresPaymentReviewsRepository } from "../../src/modules/payment-reviews/payment-reviews.repository.js";
import { PaymentReviewsService } from "../../src/modules/payment-reviews/payment-reviews.service.js";
import { PostgresNotificationsRepository } from "../../src/modules/automation/notifications.repository.js";
import { AutomationService } from "../../src/modules/automation/automation.service.js";
import { DigitalDeliveryService } from "../../src/modules/digital-delivery/digital-delivery.service.js";
import { PostgresDigitalDeliveryRepository } from "../../src/modules/digital-delivery/digital-delivery.repository.js";

export function salesFixture(db:Pool,adapter:ProviderFulfillmentAdapter) {
  const businesses=new PostgresBusinessesRepository(db),customers=new PostgresCustomersRepository(db),categories=new PostgresCategoriesRepository(db);
  const products=new PostgresProductsRepository(db),pricing=new PostgresPricingRepository(db),methods=new PostgresPaymentMethodsRepository(db);
  const crypto=new IntegrationCredentialsCrypto(randomBytes(32).toString("base64"));
  const integrations=new IntegrationsService(new PostgresIntegrationsRepository(db),crypto);
  const payments=new PaymentsService(new PostgresPaymentsRepository(db),db,new PaymentProviderRegistry([new BankTransferPaymentProvider()]),undefined,methods);
  const adapters=new ProviderFulfillmentRegistry([adapter]);
  const fulfillments=new FulfillmentsService(new PostgresFulfillmentsRepository(db),db,adapters);
  const gateway=new BotGatewayService(new CustomersService(customers),new CategoriesService(categories),new ProductsService(products,categories),
    new PricingService(pricing,products,businesses),new QuotesService(new PostgresQuotesRepository(db),new PriceCalculatorService(products,pricing),customers),
    new OrdersService(new PostgresOrdersRepository(db),db),payments,fulfillments,new PaymentMethodsService(methods),businesses);
  const sales=new PostgresSalesRepository(db),notifications=new PostgresNotificationsRepository(db),reviewRepository=new PostgresPaymentReviewsRepository(db);
  const digital=new DigitalDeliveryService(new PostgresDigitalDeliveryRepository(db),new ProductsService(products,categories),gateway,crypto,notifications);
  const delivery=new SalesDeliveryService(gateway,new PostgresProviderCatalogRepository(db),integrations,adapters,digital);
  const checkout=new SalesCheckoutService(sales,gateway,delivery,reviewRepository);
  const reviews=new PaymentReviewsService(reviewRepository,sales,checkout,payments,crypto,notifications);
  const inboxRepository=new PostgresSalesInboxRepository(db);
  return {gateway,sales,notifications,reviewRepository,delivery,checkout,reviews,payments,integrations,crypto,digital,
    inbox:new SalesInboxService(inboxRepository,sales),inboxRepository,
    access:new SalesAccessService(sales,gateway),conversation:new SalesConversationService(sales,gateway,checkout,notifications),
    automation:new AutomationService(sales,gateway,delivery,notifications,reviews,digital)};
}
