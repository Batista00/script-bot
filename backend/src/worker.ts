import { loadEnv } from "./config/env.js";
import { createDatabasePool } from "./core/database/database.js";
import { createConsoleLogger } from "./core/logger/console-logger.js";
import { NativeMercadoPagoClient } from "./integrations/mercado-pago/mercado-pago.client.js";
import { MercadoPagoPaymentProvider } from "./integrations/mercado-pago/mercado-pago.provider.js";
import { NativeSmmRajaClient } from "./integrations/smm-raja/smm-raja.client.js";
import { SmmRajaFulfillmentAdapter } from "./integrations/smm-raja/smm-raja.fulfillment.adapter.js";
import { PostgresAuthSessionsRepository } from "./modules/auth/auth.repository.js";
import { PostgresFulfillmentsRepository } from "./modules/fulfillments/fulfillments.repository.js";
import { ProviderFulfillmentRegistry } from "./modules/fulfillments/fulfillments.registry.js";
import { FulfillmentsService } from "./modules/fulfillments/fulfillments.service.js";
import { IntegrationCredentialsCrypto } from "./modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "./modules/integrations/integrations.repository.js";
import { IntegrationsService } from "./modules/integrations/integrations.service.js";
import { createWorkerSettings } from "./modules/jobs/jobs.config.js";
import { createJobHandlers } from "./modules/jobs/jobs.handlers.js";
import { PostgresJobsRepository } from "./modules/jobs/jobs.repository.js";
import { JobRegistry } from "./modules/jobs/jobs.registry.js";
import { JobsScheduler } from "./modules/jobs/jobs.scheduler.js";
import { JobsService } from "./modules/jobs/jobs.service.js";
import { PostgresJobSweepsRepository } from "./modules/jobs/jobs.sweeps.repository.js";
import { JobsWorker } from "./modules/jobs/jobs.worker.js";
import { BankTransferPaymentProvider } from "./modules/payments/bank-transfer.provider.js";
import { PostgresPaymentsRepository } from "./modules/payments/payments.repository.js";
import { PaymentProviderRegistry } from "./modules/payments/payments.registry.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { PostgresPaymentMethodsRepository } from "./modules/payment-methods/payment-methods.repository.js";

/**
 * Background worker process. It shares the HTTP server's domain services but
 * runs no routes: the queue lives in PostgreSQL, so a restart only re-claims
 * pending work instead of losing it.
 */
async function start(): Promise<void> {
  const config = loadEnv();
  const logger = createConsoleLogger(config.LOG_LEVEL);
  const db = createDatabasePool(config.DATABASE_URL);

  const integrationsService = new IntegrationsService(
    new PostgresIntegrationsRepository(db),
    new IntegrationCredentialsCrypto(config.INTEGRATIONS_ENCRYPTION_KEY),
  );
  const mercadoPagoProvider = new MercadoPagoPaymentProvider(
    integrationsService,
    new NativeMercadoPagoClient(),
    config.PUBLIC_API_BASE_URL,
    config.NODE_ENV,
  );
  const paymentMethodsRepository = new PostgresPaymentMethodsRepository(db);
  const jobsRepository = new PostgresJobsRepository(db);
  const jobsService = new JobsService(jobsRepository);
  const paymentsService = new PaymentsService(
    new PostgresPaymentsRepository(db),
    db,
    new PaymentProviderRegistry([mercadoPagoProvider, new BankTransferPaymentProvider()]),
    undefined,
    paymentMethodsRepository,
    jobsService,
    integrationsService,
  );
  const fulfillmentsService = new FulfillmentsService(
    new PostgresFulfillmentsRepository(db),
    db,
    new ProviderFulfillmentRegistry([
      new SmmRajaFulfillmentAdapter(integrationsService, new NativeSmmRajaClient()),
    ]),
    undefined,
    (details) => logger.warn(details, "Unsupported provider fulfillment status"),
  );

  const settings = createWorkerSettings(config, logger);
  const registry = new JobRegistry(createJobHandlers({
    jobs: jobsService,
    sweeps: new PostgresJobSweepsRepository(db),
    logger,
    fulfillments: {
      dispatchOrder: (businessId, orderId) =>
        fulfillmentsService.dispatchOrder(businessId, orderId),
      syncStatus: async (businessId, fulfillmentId) => {
        const fulfillment = await fulfillmentsService.syncStatus(businessId, fulfillmentId);
        return { id: fulfillment.id, status: fulfillment.status };
      },
    },
    payments: {
      reconcilePending: (businessId, paymentId) =>
        paymentsService.reconcilePending(businessId, paymentId),
    },
    sessions: new PostgresAuthSessionsRepository(db),
    limits: settings.limits,
  }));

  const worker = new JobsWorker(jobsRepository, registry, settings.worker);
  const scheduler = new JobsScheduler(jobsService, settings.scheduler);

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Worker shutting down");
    worker.stop();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const schedulerTimer = setInterval(() => {
    void scheduler.tick().catch((error: unknown) => {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Scheduler tick failed",
      );
    });
  }, 5_000);

  try {
    await scheduler.tick().catch(() => undefined);
    await worker.run();
  } finally {
    clearInterval(schedulerTimer);
    await db.end();
  }
}

start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
