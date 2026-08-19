import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";
import { AppError } from "../../src/core/errors/app-error.js";
import type { BusinessIntegration } from "../../src/modules/integrations/integrations.types.js";
import type { ProviderCatalogAdapter } from "../../src/modules/provider-catalog/provider-catalog.adapter.js";
import { PostgresProviderCatalogRepository } from "../../src/modules/provider-catalog/provider-catalog.repository.js";
import { ProviderCatalogRegistry } from "../../src/modules/provider-catalog/provider-catalog.registry.js";
import { ProviderCatalogService } from "../../src/modules/provider-catalog/provider-catalog.service.js";
import type { NormalizedProviderService } from "../../src/modules/provider-catalog/provider-catalog.types.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class FakeAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";
  services: readonly NormalizedProviderService[] = [];
  async listServices(): Promise<readonly NormalizedProviderService[]> {
    return structuredClone(this.services);
  }
}

function normalized(externalServiceId: string, rate: string): NormalizedProviderService {
  return {
    externalServiceId, name: `Provider ${externalServiceId}`, category: "Social",
    serviceType: "Default", rate, rateCurrency: null,
    minQuantity: 10, maxQuantity: 10_000, metadata: { refill: true },
  };
}

test(
  "Provider Catalog and mappings invariants against PostgreSQL",
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
    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    async function fixture(label: string) {
      const business = await db.query<{ id: string }>(
        "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
        [`Catalog ${label} ${unique}`],
      );
      const businessId = business.rows[0]?.id;
      assert.ok(businessId);
      businessIds.push(businessId);
      const integration = await db.query<{ id: string }>(
        `INSERT INTO business_integrations (
           business_id, provider_key, status, config, credentials_encrypted
         ) VALUES ($1, 'smm_raja', 'active', '{}', 'integration-test-placeholder')
         RETURNING id`,
        [businessId],
      );
      const integrationId = integration.rows[0]?.id;
      assert.ok(integrationId);
      const product = await db.query<{ id: string }>(
        `INSERT INTO products (business_id, name, type, status)
         VALUES ($1, $2, 'service', 'active') RETURNING id`,
        [businessId, `Retail ${label}`],
      );
      const productId = product.rows[0]?.id;
      assert.ok(productId);
      return { businessId, integrationId, productId };
    }

    const businessA = await fixture("A");
    const businessB = await fixture("B");
    const integrations = new Map<string, BusinessIntegration>([
      [`${businessA.businessId}:${businessA.integrationId}`, {
        ...businessA, id: businessA.integrationId, providerKey: "smm_raja",
        status: "active", config: {}, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      [`${businessB.businessId}:${businessB.integrationId}`, {
        ...businessB, id: businessB.integrationId, providerKey: "smm_raja",
        status: "active", config: {}, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    ]);
    const adapter = new FakeAdapter();
    const repository = new PostgresProviderCatalogRepository(db);
    const service = new ProviderCatalogService(
      repository,
      db,
      {
        getById: async (businessId: string, integrationId: string) => {
          const integration = integrations.get(`${businessId}:${integrationId}`);
          if (!integration) throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
          return integration;
        },
      },
      new PostgresProductsRepository(db),
      new ProviderCatalogRegistry([adapter]),
    );

    adapter.services = [normalized("100", "0.125"), normalized("200", "1.2500")];
    assert.deepEqual(await service.sync(businessA.businessId, businessA.integrationId), {
      integrationId: businessA.integrationId, providerKey: "smm_raja",
      received: 2, created: 2, updated: 0, deactivated: 0,
    });
    adapter.services = [normalized("100", "9.5")];
    await service.sync(businessB.businessId, businessB.integrationId);
    adapter.services = [normalized("100", "0.500"), normalized("300", "2")];
    assert.deepEqual(await service.sync(businessA.businessId, businessA.integrationId), {
      integrationId: businessA.integrationId, providerKey: "smm_raja",
      received: 2, created: 1, updated: 1, deactivated: 1,
    });

    const rows = await db.query<{
      business_id: string; external_service_id: string; rate: string;
      provider_status: string; rate_type: string;
    }>(
      `SELECT business_id, external_service_id, rate::text, provider_status::text,
              pg_typeof(rate)::text AS rate_type
       FROM provider_services
       WHERE business_id = ANY($1::uuid[])
       ORDER BY business_id, external_service_id`,
      [[businessA.businessId, businessB.businessId]],
    );
    assert.equal(rows.rows.length, 4);
    assert.equal(rows.rows.find((row) => row.business_id === businessA.businessId &&
      row.external_service_id === "100")?.rate, "0.500000000000");
    assert.equal(rows.rows.find((row) => row.business_id === businessA.businessId &&
      row.external_service_id === "200")?.provider_status, "inactive");
    assert.equal(rows.rows.find((row) => row.business_id === businessB.businessId)?.provider_status,
      "active");
    assert.ok(rows.rows.every((row) => row.rate_type === "numeric"));

    const servicesA = await service.listServices(businessA.businessId, {
      limit: 50, offset: 0, providerStatus: "active",
    });
    const servicesB = await service.listServices(businessB.businessId, {
      limit: 50, offset: 0,
    });
    const firstA = servicesA.find((item) => item.externalServiceId === "100");
    const secondA = servicesA.find((item) => item.externalServiceId === "300");
    const firstB = servicesB[0];
    assert.ok(firstA && secondA && firstB);
    const original = await service.createMapping(businessA.businessId, businessA.productId, {
      providerServiceId: firstA.id,
    });
    await assert.rejects(
      service.createMapping(businessA.businessId, businessA.productId, {
        providerServiceId: secondA.id,
      }),
      (error: unknown) => error instanceof AppError &&
        error.code === "PRODUCT_PROVIDER_MAPPING_ALREADY_ACTIVE",
    );
    await assert.rejects(
      service.createMapping(businessA.businessId, businessA.productId, {
        providerServiceId: firstB.id,
      }),
      (error: unknown) => error instanceof AppError && error.code === "PROVIDER_SERVICE_NOT_FOUND",
    );
    const replacement = await service.updateMapping(businessA.businessId, businessA.productId, {
      providerServiceId: secondA.id,
    });
    assert.notEqual(replacement.id, original.id);
    const history = await db.query<{ status: string }>(
      `SELECT status::text FROM product_provider_mappings
       WHERE business_id = $1 AND product_id = $2 ORDER BY created_at, id`,
      [businessA.businessId, businessA.productId],
    );
    assert.equal(history.rows.length, 2);
    assert.equal(history.rows.filter((row) => row.status === "active").length, 1);
    assert.equal(history.rows.filter((row) => row.status === "inactive").length, 1);
  },
);
