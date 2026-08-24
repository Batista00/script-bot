import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { PostgresCategoriesRepository } from "../../src/modules/categories/categories.repository.js";
import type { BusinessIntegration } from "../../src/modules/integrations/integrations.types.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import type { ProviderCatalogAdapter } from "../../src/modules/provider-catalog/provider-catalog.adapter.js";
import { PostgresProviderCatalogRepository } from "../../src/modules/provider-catalog/provider-catalog.repository.js";
import { ProviderCatalogRegistry } from "../../src/modules/provider-catalog/provider-catalog.registry.js";
import { ProviderCatalogService } from "../../src/modules/provider-catalog/provider-catalog.service.js";
import { ProviderProductImportService } from "../../src/modules/provider-catalog/provider-product-import.service.js";
import type { NormalizedProviderService } from "../../src/modules/provider-catalog/provider-catalog.types.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class FakeAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";
  services: readonly NormalizedProviderService[] = [];
  async listServices(): Promise<readonly NormalizedProviderService[]> {
    return structuredClone(this.services);
  }
  async getBalance() { return { balance: "12.50", currency: "USD" }; }
}

function normalized(externalServiceId: string, rate: string): NormalizedProviderService {
  return {
    externalServiceId, name: `Provider ${externalServiceId}`, category: "Social",
    serviceType: "Default", rate, rateCurrency: null,
    minQuantity: 10, maxQuantity: 10_000, metadata: { refill: true },
    providerDescription: "Provider description",
    orderCapabilities: {
      supported: true,
      required: [{ key: "targetUrl", providerField: "link", type: "url" }],
      optional: [], source: "official",
    },
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
      received: 2, normalized: 2, rejected: 0, rejectionReasons: {},
      created: 2, updated: 0, reactivated: 0, deactivated: 0,
    });
    adapter.services = [normalized("100", "9.5")];
    await service.sync(businessB.businessId, businessB.integrationId);
    adapter.services = [normalized("100", "0.500"), normalized("300", "2")];
    assert.deepEqual(await service.sync(businessA.businessId, businessA.integrationId), {
      integrationId: businessA.integrationId, providerKey: "smm_raja",
      received: 2, normalized: 2, rejected: 0, rejectionReasons: {},
      created: 1, updated: 1, reactivated: 0, deactivated: 1,
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
    const exactService = await service.listServices(businessA.businessId, {
      limit: 50, offset: 0, externalServiceId: "100",
    });
    assert.deepEqual(exactService.map((item) => item.externalServiceId), ["100"]);
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

    const productsRepository = new PostgresProductsRepository(db);
    const importer = new ProviderProductImportService(
      db,
      repository,
      new PostgresCategoriesRepository(db),
      productsRepository,
      new PostgresPricingRepository(db),
    );
    const imported = await importer.import(businessA.businessId, {
      providerServiceId: firstA.id,
      name: "Atomic retail service",
      description: "Created from provider catalog",
      categoryId: null,
      sku: `ATOMIC-${unique}`,
      type: "service",
      minQuantity: 100,
      maxQuantity: 5_000,
      currency: "CLP",
      pricingType: "unit",
      retailPrice: 25,
      status: "active",
    });
    assert.equal(imported.price.productId, imported.product.id);
    assert.equal(imported.mapping.productId, imported.product.id);
    assert.equal(imported.mapping.providerServiceId, firstA.id);
    assert.equal(imported.product.requiredInputs?.[0]?.key, "targetUrl");
    const atomicRows = await db.query<{ products: number; prices: number; mappings: number }>(
      `SELECT
         (SELECT count(*)::integer FROM products WHERE id = $1) AS products,
         (SELECT count(*)::integer FROM product_prices WHERE product_id = $1) AS prices,
         (SELECT count(*)::integer FROM product_provider_mappings WHERE product_id = $1) AS mappings`,
      [imported.product.id],
    );
    assert.deepEqual(atomicRows.rows[0], { products: 1, prices: 1, mappings: 1 });
    const mappedServices = await service.listServices(businessA.businessId, {
      limit: 50, offset: 0, search: "Provider 100", serviceType: "Default",
      mappingStatus: "mapped",
    });
    assert.equal(mappedServices.find((item) => item.id === firstA.id)?.mappingCount, 1);

    const beforeResync = await db.query(
      `SELECT p.name, p.description, p.required_inputs, pp.unit_price, pp.currency,
              ppm.provider_service_id
       FROM products p
       JOIN product_prices pp ON pp.business_id = p.business_id AND pp.product_id = p.id
       JOIN product_provider_mappings ppm
         ON ppm.business_id = p.business_id AND ppm.product_id = p.id AND ppm.status = 'active'
       WHERE p.business_id = $1 AND p.id = $2`,
      [businessA.businessId, imported.product.id],
    );
    adapter.services = [normalized("100", "7.750"), normalized("300", "2")];
    await service.sync(businessA.businessId, businessA.integrationId);
    const afterResync = await db.query(
      `SELECT p.name, p.description, p.required_inputs, pp.unit_price, pp.currency,
              ppm.provider_service_id
       FROM products p
       JOIN product_prices pp ON pp.business_id = p.business_id AND pp.product_id = p.id
       JOIN product_provider_mappings ppm
         ON ppm.business_id = p.business_id AND ppm.product_id = p.id AND ppm.status = 'active'
       WHERE p.business_id = $1 AND p.id = $2`,
      [businessA.businessId, imported.product.id],
    );
    assert.deepEqual(afterResync.rows, beforeResync.rows);
    await assert.rejects(
      importer.import(businessB.businessId, {
        providerServiceId: firstA.id,
        name: "Cross business",
        type: "service",
        currency: "CLP",
        pricingType: "fixed",
        retailPrice: 1_000,
        status: "active",
      }),
      (error: unknown) => error instanceof AppError && error.code === "PROVIDER_SERVICE_NOT_FOUND",
    );

    await db.query(
      `INSERT INTO quotes (
         business_id, product_id, quantity, product_name, currency,
         pricing_type, unit_price, total_price
       ) VALUES ($1, $2, 100, $3, 'CLP', 'unit', 25, 2500)`,
      [businessA.businessId, imported.product.id, imported.product.name],
    );
    await assert.rejects(productsRepository.delete(businessA.businessId, imported.product.id));
    assert.ok(await productsRepository.findById(businessA.businessId, imported.product.id));

    const disposable = await importer.import(businessA.businessId, {
      providerServiceId: firstA.id,
      name: "Disposable retail service",
      type: "service",
      currency: "CLP",
      pricingType: "fixed",
      retailPrice: 1_000,
      status: "inactive",
    });
    const includingInactiveProduct = await service.listServices(businessA.businessId, {
      limit: 50, offset: 0, externalServiceId: "100", mappingStatus: "mapped",
    });
    assert.equal(
      includingInactiveProduct.find((item) => item.id === firstA.id)?.mappingCount,
      2,
    );
    assert.equal(await productsRepository.delete(businessA.businessId, disposable.product.id), true);
    const cascaded = await db.query<{ prices: number; mappings: number }>(
      `SELECT
         (SELECT count(*)::integer FROM product_prices WHERE product_id = $1) AS prices,
         (SELECT count(*)::integer FROM product_provider_mappings WHERE product_id = $1) AS mappings`,
      [disposable.product.id],
    );
    assert.deepEqual(cascaded.rows[0], { prices: 0, mappings: 0 });
  },
);
