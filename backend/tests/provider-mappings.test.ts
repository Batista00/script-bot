import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import type { BusinessIntegration } from "../src/modules/integrations/integrations.types.js";
import { ProviderCatalogRegistry } from "../src/modules/provider-catalog/provider-catalog.registry.js";
import { ProviderCatalogService } from "../src/modules/provider-catalog/provider-catalog.service.js";
import type { ProviderService } from "../src/modules/provider-catalog/provider-catalog.types.js";
import type { Product } from "../src/modules/products/products.types.js";
import {
  catalogBusinessA,
  catalogBusinessB,
  catalogIntegrationA,
  catalogIntegrationB,
  catalogNow,
  catalogProductA,
  catalogProductB,
  createMemoryPool,
  MemoryProviderCatalogRepository,
  normalizedService,
} from "./support/provider-catalog-memory.js";

function product(id: string, businessId: string): Product {
  return {
    id, businessId, categoryId: null, name: `Retail ${id}`,
    description: "Commercial description", type: "service", sku: null,
    minQuantity: 5, maxQuantity: 500, status: "active",
    createdAt: catalogNow, updatedAt: catalogNow,
  };
}

function providerService(
  businessId: string,
  integrationId: string,
  status: "active" | "inactive" = "active",
): ProviderService {
  return {
    id: randomUUID(), businessId, integrationId, providerKey: "smm_raja",
    ...normalizedService(randomUUID()), providerStatus: status,
    lastSyncedAt: catalogNow, createdAt: catalogNow, updatedAt: catalogNow,
  };
}

function integration(
  id: string,
  businessId: string,
  status: "active" | "inactive" = "active",
): BusinessIntegration {
  return {
    id, businessId, providerKey: "smm_raja", status, config: {},
    createdAt: catalogNow, updatedAt: catalogNow,
  };
}

function setup() {
  const repository = new MemoryProviderCatalogRepository();
  const { pool } = createMemoryPool(repository);
  const products = new Map([
    [`${catalogBusinessA}:${catalogProductA}`, product(catalogProductA, catalogBusinessA)],
    [`${catalogBusinessB}:${catalogProductB}`, product(catalogProductB, catalogBusinessB)],
  ]);
  const integrations = new Map([
    [`${catalogBusinessA}:${catalogIntegrationA}`, integration(catalogIntegrationA, catalogBusinessA)],
    [`${catalogBusinessB}:${catalogIntegrationB}`, integration(catalogIntegrationB, catalogBusinessB)],
  ]);
  const service = new ProviderCatalogService(
    repository,
    pool,
    {
      getById: async (businessId: string, integrationId: string) => {
        const value = integrations.get(`${businessId}:${integrationId}`);
        if (!value) throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
        return structuredClone(value);
      },
    },
    {
      findById: async (businessId: string, productId: string) =>
        structuredClone(products.get(`${businessId}:${productId}`) ?? null),
    },
    new ProviderCatalogRegistry(),
  );
  return { repository, products, integrations, service };
}

test("creates a valid Product to ProviderService mapping", async () => {
  const { repository, service } = setup();
  const external = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(external);

  const mapping = await service.createMapping(catalogBusinessA, catalogProductA, {
    providerServiceId: external.id,
  });

  assert.equal(mapping.status, "active");
  assert.equal(mapping.providerServiceId, external.id);
  assert.deepEqual(await service.getMapping(catalogBusinessA, catalogProductA), mapping);
});

test("cross-business ProviderService is rejected as not found", async () => {
  const { repository, service } = setup();
  const external = providerService(catalogBusinessB, catalogIntegrationB);
  repository.services.push(external);

  await assert.rejects(
    service.createMapping(catalogBusinessA, catalogProductA, {
      providerServiceId: external.id,
    }),
    (error: unknown) => error instanceof AppError && error.code === "PROVIDER_SERVICE_NOT_FOUND",
  );
});

test("inactive ProviderService cannot be activated", async () => {
  const { repository, service } = setup();
  const external = providerService(catalogBusinessA, catalogIntegrationA, "inactive");
  repository.services.push(external);
  await assert.rejects(
    service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: external.id }),
    (error: unknown) => error instanceof AppError && error.code === "PROVIDER_SERVICE_INACTIVE",
  );
});

test("inactive integration cannot back an active mapping", async () => {
  const { repository, integrations, service } = setup();
  const external = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(external);
  integrations.set(
    `${catalogBusinessA}:${catalogIntegrationA}`,
    integration(catalogIntegrationA, catalogBusinessA, "inactive"),
  );
  await assert.rejects(
    service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: external.id }),
    (error: unknown) => error instanceof AppError && error.code === "INTEGRATION_INACTIVE",
  );
});

test("only one active mapping is allowed for a Product", async () => {
  const { repository, service } = setup();
  const first = providerService(catalogBusinessA, catalogIntegrationA);
  const second = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(first, second);
  await service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: first.id });

  await assert.rejects(
    service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: second.id }),
    (error: unknown) => error instanceof AppError &&
      error.code === "PRODUCT_PROVIDER_MAPPING_ALREADY_ACTIVE",
  );
});

test("changing provider preserves the previous mapping as inactive history", async () => {
  const { repository, service } = setup();
  const first = providerService(catalogBusinessA, catalogIntegrationA);
  const second = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(first, second);
  const original = await service.createMapping(catalogBusinessA, catalogProductA, {
    providerServiceId: first.id,
  });

  const replacement = await service.updateMapping(catalogBusinessA, catalogProductA, {
    providerServiceId: second.id,
  });

  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.status, "active");
  assert.equal(repository.mappings.find((item) => item.id === original.id)?.status, "inactive");
  assert.equal(repository.mappings.filter((item) => item.status === "active").length, 1);
});

test("inactive historical mapping may remain and be reactivated when dependencies are usable", async () => {
  const { repository, service } = setup();
  const external = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(external);
  await service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: external.id });
  const inactive = await service.updateMapping(catalogBusinessA, catalogProductA, {
    status: "inactive",
  });
  assert.equal(inactive.status, "inactive");
  assert.equal((await service.updateMapping(catalogBusinessA, catalogProductA, {
    status: "active",
  })).status, "active");
});

test("mapping creation does not mutate Product or retail Pricing state", async () => {
  const { repository, products, service } = setup();
  const external = providerService(catalogBusinessA, catalogIntegrationA);
  repository.services.push(external);
  const productBefore = structuredClone(products.get(`${catalogBusinessA}:${catalogProductA}`));
  const pricing = [{ currency: "CLP", unitPrice: 1500 }];
  const pricingBefore = structuredClone(pricing);

  await service.createMapping(catalogBusinessA, catalogProductA, { providerServiceId: external.id });

  assert.deepEqual(products.get(`${catalogBusinessA}:${catalogProductA}`), productBefore);
  assert.deepEqual(pricing, pricingBefore);
});
