import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { AppError } from "../../src/core/errors/app-error.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { IntegrationCredentialsCrypto } from "../../src/modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "../../src/modules/integrations/integrations.repository.js";
import { IntegrationsService } from "../../src/modules/integrations/integrations.service.js";
import { PostgresProviderCatalogRepository } from "../../src/modules/provider-catalog/provider-catalog.repository.js";
import {
  ProviderRequestRejectedError,
  type ProviderCatalogAdapter,
} from "../../src/modules/provider-catalog/provider-catalog.adapter.js";
import { ProviderCatalogRegistry } from "../../src/modules/provider-catalog/provider-catalog.registry.js";
import { ProviderCatalogService } from "../../src/modules/provider-catalog/provider-catalog.service.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { PostgresPaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import { PaymentProviderRegistry } from "../../src/modules/payments/payments.registry.js";
import {
  type FetchProviderPaymentStatusInput,
  type PaymentProvider,
  PaymentProviderCredentialsInvalidError,
  type ProviderPaymentStatus,
} from "../../src/modules/payments/payments.provider.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import type { NormalizedProviderService } from "../../src/modules/provider-catalog/provider-catalog.types.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class FakeCatalogAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";
  failWith: Error | null = null;
  readonly services: NormalizedProviderService[] = [];

  async listServices(): Promise<NormalizedProviderService[]> {
    return this.services;
  }

  async getBalance() {
    if (this.failWith) throw this.failWith;
    return { balance: "12.5", currency: "USD" };
  }
}

class FakePaymentProvider implements PaymentProvider {
  readonly key = "mercado_pago";
  failWith: Error | null = null;

  async createPayment() {
    return { status: "pending" as const };
  }

  async fetchStatus(_input: FetchProviderPaymentStatusInput): Promise<ProviderPaymentStatus | null> {
    return null;
  }

  async verifyCredentials(): Promise<void> {
    if (this.failWith) throw this.failWith;
  }
}

async function expectAppError(promise: Promise<unknown>, code: string, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, status);
    return true;
  });
}

test(
  "provider connection tests report credentials without side effects",
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
    const db = createDatabasePool(testDatabaseUrl);
    const key = Buffer.alloc(32, 3).toString("base64");
    const integrations = new IntegrationsService(
      new PostgresIntegrationsRepository(db),
      new IntegrationCredentialsCrypto(key),
    );
    const catalogAdapter = new FakeCatalogAdapter();
    const catalog = new ProviderCatalogService(
      new PostgresProviderCatalogRepository(db),
      db,
      integrations,
      new PostgresProductsRepository(db),
      new ProviderCatalogRegistry([catalogAdapter]),
    );
    const paymentProvider = new FakePaymentProvider();
    const payments = new PaymentsService(
      new PostgresPaymentsRepository(db),
      db,
      new PaymentProviderRegistry([paymentProvider]),
      undefined,
      undefined,
      undefined,
      integrations,
    );

    const business = await db.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Connections ${Date.now()}`],
    );
    const businessId = business.rows[0]?.id;
    assert.ok(businessId);
    t.after(async () => {
      await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      await db.end();
    });

    const catalogIntegration = await integrations.create(businessId, {
      providerKey: "smm_raja",
      credentials: { apiKey: "fake-api-key" },
    });
    const ok = await catalog.testConnection(businessId, catalogIntegration.id);
    assert.equal(ok.connectionStatus, "ok");
    assert.equal(ok.balance, "12.5");
    assert.equal(ok.currency, "USD");
    assert.equal(ok.providerKey, "smm_raja");

    const state = await db.query<{ connection_status: string; provider_balance: string | null }>(
      `SELECT connection_status::text AS connection_status, provider_balance
       FROM provider_catalog_states WHERE business_id = $1 AND integration_id = $2`,
      [businessId, catalogIntegration.id],
    );
    assert.equal(state.rows[0]?.connection_status, "ok");
    assert.equal(Number(state.rows[0]?.provider_balance), 12.5);

    catalogAdapter.failWith = new ProviderRequestRejectedError();
    await expectAppError(
      catalog.testConnection(businessId, catalogIntegration.id),
      "PROVIDER_REQUEST_REJECTED",
      502,
    );
    const failedState = await db.query<{ connection_status: string; last_error_code: string }>(
      `SELECT connection_status::text AS connection_status, last_error_code
       FROM provider_catalog_states WHERE business_id = $1 AND integration_id = $2`,
      [businessId, catalogIntegration.id],
    );
    assert.equal(failedState.rows[0]?.connection_status, "error");
    assert.equal(failedState.rows[0]?.last_error_code, "PROVIDER_REQUEST_REJECTED");

    const paymentIntegration = await integrations.create(businessId, {
      providerKey: "mercado_pago",
      config: {},
      credentials: { accessToken: "fake-token", webhookSecret: "fake-secret" },
    });
    const paymentOk = await payments.testConnection(businessId, paymentIntegration.id);
    assert.equal(paymentOk.connectionStatus, "ok");
    assert.equal(paymentOk.providerKey, "mercado_pago");

    paymentProvider.failWith = new PaymentProviderCredentialsInvalidError();
    await expectAppError(
      payments.testConnection(businessId, paymentIntegration.id),
      "PAYMENT_PROVIDER_CREDENTIALS_INVALID",
      409,
    );

    // A catalog test against a payment integration has no adapter.
    await expectAppError(
      catalog.testConnection(businessId, paymentIntegration.id),
      "PROVIDER_CATALOG_NOT_AVAILABLE",
      503,
    );

    await integrations.update(businessId, paymentIntegration.id, { status: "inactive" });
    await expectAppError(
      payments.testConnection(businessId, paymentIntegration.id),
      "INTEGRATION_INACTIVE",
      409,
    );

    await integrations.update(businessId, catalogIntegration.id, { status: "inactive" });
    await expectAppError(
      catalog.testConnection(businessId, catalogIntegration.id),
      "INTEGRATION_INACTIVE",
      409,
    );
  },
);
