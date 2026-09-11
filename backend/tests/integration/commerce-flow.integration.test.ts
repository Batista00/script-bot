import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import type { Env } from "../../src/config/env.js";
import { createConsoleLogger } from "../../src/core/logger/console-logger.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { IntegrationCredentialsCrypto } from "../../src/modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "../../src/modules/integrations/integrations.repository.js";
import { IntegrationsService } from "../../src/modules/integrations/integrations.service.js";
import { PostgresAuthSessionsRepository } from "../../src/modules/auth/auth.repository.js";
import { PostgresCustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";
import { PostgresFulfillmentsRepository } from "../../src/modules/fulfillments/fulfillments.repository.js";
import { ProviderFulfillmentRegistry } from "../../src/modules/fulfillments/fulfillments.registry.js";
import {
  type CreateProviderOrderInput,
  type CreateProviderOrderResult,
  type GetProviderOrderStatusInput,
  type ProviderFulfillmentAdapter,
  type ProviderOrderStatusResult,
} from "../../src/modules/fulfillments/fulfillments.adapter.js";
import { FulfillmentsService } from "../../src/modules/fulfillments/fulfillments.service.js";
import { createWorkerSettings } from "../../src/modules/jobs/jobs.config.js";
import { createJobHandlers } from "../../src/modules/jobs/jobs.handlers.js";
import { PostgresJobsRepository } from "../../src/modules/jobs/jobs.repository.js";
import { JobRegistry } from "../../src/modules/jobs/jobs.registry.js";
import { JobsService } from "../../src/modules/jobs/jobs.service.js";
import { PostgresJobSweepsRepository } from "../../src/modules/jobs/jobs.sweeps.repository.js";
import { JobsWorker } from "../../src/modules/jobs/jobs.worker.js";
import { jobTypes } from "../../src/modules/jobs/jobs.types.js";
import { PostgresOrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";
import { BankTransferPaymentProvider } from "../../src/modules/payments/bank-transfer.provider.js";
import { PostgresPaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import { PaymentProviderRegistry } from "../../src/modules/payments/payments.registry.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import { PostgresPaymentMethodsRepository } from "../../src/modules/payment-methods/payment-methods.repository.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import { QuotesService } from "../../src/modules/quotes/quotes.service.js";
import { PostgresQuotesRepository } from "../../src/modules/quotes/quotes.repository.js";
import { PriceCalculatorService } from "../../src/modules/pricing/price-calculator.service.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * Deterministic stand-in for the wholesaler. It records the submitted order and
 * answers the status poll the way SMM Raja does, without any network call.
 */
class FakeProviderAdapter implements ProviderFulfillmentAdapter {
  readonly key = "fake_provider";
  readonly created: CreateProviderOrderInput[] = [];
  nextStatus: ProviderOrderStatusResult["status"] = "in_progress";

  async createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    this.created.push(input);
    return { providerOrderId: String(9000 + this.created.length) };
  }

  async getOrderStatus(input: GetProviderOrderStatusInput): Promise<ProviderOrderStatusResult> {
    return {
      providerOrderId: input.providerOrderId,
      providerStatusRaw: this.nextStatus === "completed" ? "Completed" : "In progress",
      status: this.nextStatus,
      charge: "1.25",
      currency: "USD",
      remains: this.nextStatus === "completed" ? 0 : 40,
      startCount: 60,
    };
  }
}

test(
  "product to provider order end to end with a paid bank transfer",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });

    const config: Env = {
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      AUTH_SESSION_TTL_HOURS: 168,
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    };
    const db = createDatabasePool(testDatabaseUrl);
    const logger = createConsoleLogger("silent");
    const integrations = new IntegrationsService(
      new PostgresIntegrationsRepository(db),
      new IntegrationCredentialsCrypto(config.INTEGRATIONS_ENCRYPTION_KEY),
    );
    const products = new PostgresProductsRepository(db);
    const prices = new PostgresPricingRepository(db);
    const customers = new CustomersService(new PostgresCustomersRepository(db));
    const adapter = new FakeProviderAdapter();
    const fulfillments = new FulfillmentsService(
      new PostgresFulfillmentsRepository(db),
      db,
      new ProviderFulfillmentRegistry([adapter]),
    );
    const jobsRepository = new PostgresJobsRepository(db);
    const jobs = new JobsService(jobsRepository);
    const payments = new PaymentsService(
      new PostgresPaymentsRepository(db),
      db,
      new PaymentProviderRegistry([new BankTransferPaymentProvider()]),
      undefined,
      new PostgresPaymentMethodsRepository(db),
      jobs,
    );
    const orders = new OrdersService(new PostgresOrdersRepository(db), db);
    const quotes = new QuotesService(
      new PostgresQuotesRepository(db),
      new PriceCalculatorService(products, prices),
      new PostgresCustomersRepository(db),
    );
    const settings = createWorkerSettings(config, logger);
    const worker = new JobsWorker(
      jobsRepository,
      new JobRegistry(createJobHandlers({
        jobs,
        sweeps: new PostgresJobSweepsRepository(db),
        logger,
        fulfillments: {
          dispatchOrder: (businessId, orderId) => fulfillments.dispatchOrder(businessId, orderId),
          syncStatus: async (businessId, fulfillmentId) => {
            const fulfillment = await fulfillments.syncStatus(businessId, fulfillmentId);
            return { id: fulfillment.id, status: fulfillment.status };
          },
        },
        payments: {
          reconcilePending: (businessId, paymentId) =>
            payments.reconcilePending(businessId, paymentId),
        },
        sessions: new PostgresAuthSessionsRepository(db),
        limits: settings.limits,
      })),
      { ...settings.worker, workerId: "e2e-worker", batchSize: 20 },
    );

    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const business = await db.query<{ id: string }>(
      "INSERT INTO businesses (name, currency) VALUES ($1, 'CLP') RETURNING id",
      [`E2E ${unique}`],
    );
    const businessId = business.rows[0]?.id;
    assert.ok(businessId);
    businessIds.push(businessId);

    const integration = await integrations.create(businessId, {
      providerKey: adapter.key,
      credentials: { apiKey: "fake-key" },
    });

    const product = await products.create(businessId, {
      name: "Seguidores E2E",
      type: "service",
      categoryId: null,
      description: null,
      sku: null,
      status: "active",
      minQuantity: 10,
      maxQuantity: 10_000,
      requiredInputs: [{
        key: "targetUrl",
        label: "Enlace",
        helpText: null,
        type: "url",
        required: true,
        position: 0,
        validation: {},
      }],
    });
    await prices.create(businessId, product.id, {
      pricingType: "unit",
      currency: "CLP",
      fixedPrice: null,
      unitPrice: 5_000,
      minQuantity: 10,
      maxQuantity: 10_000,
      status: "active",
    });
    const providerService = await db.query<{ id: string }>(
      `INSERT INTO provider_services (
         business_id, integration_id, provider_key, external_service_id, name,
         service_type, rate, rate_currency, min_quantity, max_quantity,
         provider_status, last_synced_at
       ) VALUES ($1, $2, $3, '321', 'Seguidores proveedor', 'Default',
         0.5, 'USD', 10, 10_000, 'active', now())
       RETURNING id`,
      [businessId, integration.id, adapter.key],
    );
    const providerServiceId = providerService.rows[0]?.id;
    assert.ok(providerServiceId);
    await db.query(
      `INSERT INTO product_provider_mappings (business_id, product_id, provider_service_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [businessId, product.id, providerServiceId],
    );

    const customer = await customers.create(businessId, {
      name: "Cliente E2E",
      phone: "+56911111111",
    });
    const quote = await quotes.create(businessId, {
      customerId: customer.id,
      productId: product.id,
      quantity: 100,
      currency: "CLP",
    });
    assert.equal(quote.totalPrice, 500_000);

    const order = await orders.create(businessId, {
      quoteId: quote.id,
      fulfillmentInput: { targetUrl: "https://instagram.com/e2e" },
    });
    assert.equal(order.status, "pending_payment");
    assert.deepEqual(order.items[0]?.fulfillmentInput, {
      targetUrl: "https://instagram.com/e2e",
    });

    const payment = await payments.create(businessId, order.id, {
      providerKey: "bank_transfer",
    });
    await payments.confirmBankTransfer(businessId, payment.payment.id, `receipt-${unique}`);

    const paidOrder = await orders.getById(businessId, order.id);
    assert.equal(paidOrder.status, "paid");

    const queued = await jobsRepository.findById(
      (await jobs.list({ limit: 1, offset: 0, businessId }))[0]?.id ?? "",
    );
    assert.equal(queued?.jobType, jobTypes.orderFulfill);
    assert.equal(queued?.status, "pending");

    // First worker cycle: creates the fulfillment and submits it to the provider.
    await worker.tick();
    const afterDispatch = await fulfillments.listByOrder(businessId, order.id);
    assert.equal(afterDispatch.length, 1);
    assert.equal(afterDispatch[0]?.status, "submitted");
    assert.equal(afterDispatch[0]?.providerOrderId, "9001");
    assert.equal(adapter.created.length, 1);
    assert.equal(adapter.created[0]?.externalServiceId, "321");
    assert.deepEqual(adapter.created[0]?.fulfillmentInput, {
      targetUrl: "https://instagram.com/e2e",
    });
    const processingOrder = await orders.getById(businessId, order.id);
    assert.equal(processingOrder.status, "processing");

    // Second cycle: the sync job polls the provider and completes the order.
    adapter.nextStatus = "completed";
    await worker.tick();
    const synced = await fulfillments.getById(businessId, afterDispatch[0]!.id);
    assert.equal(synced.status, "completed");
    assert.equal(synced.providerStatusRaw, "Completed");
    // numeric(30,12) round-trips with its full scale.
    assert.equal(Number(synced.providerCharge), 1.25);
    const completedOrder = await orders.getById(businessId, order.id);
    assert.equal(completedOrder.status, "completed");

    // A third cycle must not create a second provider order.
    await worker.tick();
    await worker.tick();
    assert.equal(adapter.created.length, 1);
    const finalItems = await fulfillments.listByOrder(businessId, order.id);
    assert.equal(finalItems.length, 1);

    const jobsAfter = await db.query<{ status: string; count: number }>(
      `SELECT status::text AS status, count(*)::integer AS count
       FROM job_queue WHERE payload->>'businessId' = $1 GROUP BY status`,
      [businessId],
    );
    const byStatus = new Map(jobsAfter.rows.map((row) => [row.status, row.count]));
    assert.equal(byStatus.get("pending") ?? 0, 0);
    assert.equal(byStatus.get("failed") ?? 0, 0);
    assert.ok((byStatus.get("completed") ?? 0) >= 2);
  },
);
