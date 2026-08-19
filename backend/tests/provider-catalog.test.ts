import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import type { BusinessIntegration } from "../src/modules/integrations/integrations.types.js";
import type { ProviderCatalogAdapter } from "../src/modules/provider-catalog/provider-catalog.adapter.js";
import {
  ProviderResponseInvalidError,
  ProviderTemporarilyUnavailableError,
} from "../src/modules/provider-catalog/provider-catalog.adapter.js";
import { ProviderCatalogRegistry } from "../src/modules/provider-catalog/provider-catalog.registry.js";
import { ProviderCatalogService } from "../src/modules/provider-catalog/provider-catalog.service.js";
import type { NormalizedProviderService } from "../src/modules/provider-catalog/provider-catalog.types.js";
import {
  catalogBusinessA,
  catalogBusinessB,
  catalogIntegrationA,
  catalogIntegrationB,
  catalogNow,
  createMemoryPool,
  MemoryProviderCatalogRepository,
  normalizedService,
} from "./support/provider-catalog-memory.js";

class FakeCatalogAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";
  services: readonly NormalizedProviderService[] = [];
  calls: string[] = [];
  error?: Error;
  duringExternalCall?: () => void;
  async listServices(businessId: string): Promise<readonly NormalizedProviderService[]> {
    this.calls.push(businessId);
    this.duringExternalCall?.();
    if (this.error) throw this.error;
    return structuredClone(this.services);
  }
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
  const { pool, state } = createMemoryPool(repository);
  const adapter = new FakeCatalogAdapter();
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
    { findById: async () => null },
    new ProviderCatalogRegistry([adapter]),
    () => new Date(catalogNow),
  );
  return { repository, state, adapter, integrations, service };
}

test("sync creates services and reports deterministic counts", async () => {
  const { repository, adapter, service } = setup();
  adapter.services = [normalizedService("100"), normalizedService("200")];

  const result = await service.sync(catalogBusinessA, catalogIntegrationA);

  assert.deepEqual(result, {
    integrationId: catalogIntegrationA,
    providerKey: "smm_raja",
    received: 2,
    created: 2,
    updated: 0,
    deactivated: 0,
  });
  assert.equal(repository.services.length, 2);
  assert.equal(repository.services[0]?.rate, "0.12500000");
});

test("second sync upserts known services and deactivates disappeared services", async () => {
  const { repository, adapter, service } = setup();
  adapter.services = [normalizedService("100"), normalizedService("200")];
  await service.sync(catalogBusinessA, catalogIntegrationA);
  adapter.services = [normalizedService("100", { name: "Updated service" }), normalizedService("300")];

  const result = await service.sync(catalogBusinessA, catalogIntegrationA);

  assert.deepEqual(result, {
    integrationId: catalogIntegrationA, providerKey: "smm_raja",
    received: 2, created: 1, updated: 1, deactivated: 1,
  });
  assert.equal(repository.services.find((item) => item.externalServiceId === "100")?.name,
    "Updated service");
  assert.equal(repository.services.find((item) => item.externalServiceId === "200")?.providerStatus,
    "inactive");
});

test("sync for Business A never deactivates Business B services", async () => {
  const { repository, adapter, service } = setup();
  adapter.services = [normalizedService("shared")];
  await service.sync(catalogBusinessA, catalogIntegrationA);
  await service.sync(catalogBusinessB, catalogIntegrationB);
  adapter.services = [];

  await service.sync(catalogBusinessA, catalogIntegrationA);

  assert.equal(repository.services.find((item) =>
    item.businessId === catalogBusinessA)?.providerStatus, "inactive");
  assert.equal(repository.services.find((item) =>
    item.businessId === catalogBusinessB)?.providerStatus, "active");
});

test("external provider call occurs before the PostgreSQL transaction", async () => {
  const { state, adapter, service } = setup();
  adapter.services = [normalizedService("100")];
  adapter.duringExternalCall = () => assert.equal(state.inTransaction, false);

  await service.sync(catalogBusinessA, catalogIntegrationA);

  assert.equal(state.inTransaction, false);
  assert.deepEqual(adapter.calls, [catalogBusinessA]);
});

test("duplicate provider IDs reject the complete sync before persistence", async () => {
  const { repository, adapter, service } = setup();
  adapter.services = [normalizedService("100"), normalizedService("100")];

  await assert.rejects(
    service.sync(catalogBusinessA, catalogIntegrationA),
    (error: unknown) => error instanceof AppError && error.code === "PROVIDER_RESPONSE_INVALID",
  );
  assert.equal(repository.services.length, 0);
});

test("provider response and transport failures are controlled without opening a transaction", async () => {
  for (const [failure, code] of [
    [new ProviderResponseInvalidError(), "PROVIDER_RESPONSE_INVALID"],
    [new ProviderTemporarilyUnavailableError(), "PROVIDER_TEMPORARILY_UNAVAILABLE"],
  ] as const) {
    const { repository, state, adapter, service } = setup();
    adapter.error = failure;
    await assert.rejects(
      service.sync(catalogBusinessA, catalogIntegrationA),
      (error: unknown) => error instanceof AppError && error.code === code,
    );
    assert.equal(state.inTransaction, false);
    assert.equal(repository.services.length, 0);
  }
});

test("inactive integration is refused before calling the adapter", async () => {
  const { adapter, integrations, service } = setup();
  integrations.set(
    `${catalogBusinessA}:${catalogIntegrationA}`,
    integration(catalogIntegrationA, catalogBusinessA, "inactive"),
  );
  await assert.rejects(
    service.sync(catalogBusinessA, catalogIntegrationA),
    (error: unknown) => error instanceof AppError && error.code === "INTEGRATION_INACTIVE",
  );
  assert.equal(adapter.calls.length, 0);
});

test("provider service listing is business-scoped and normalizes provider filter", async () => {
  const { adapter, service } = setup();
  adapter.services = [normalizedService("100")];
  await service.sync(catalogBusinessA, catalogIntegrationA);
  assert.equal((await service.listServices(catalogBusinessA, {
    limit: 50, offset: 0, providerKey: " SMM_RAJA ",
  })).length, 1);
  assert.equal((await service.listServices(catalogBusinessB, {
    limit: 50, offset: 0,
  })).length, 0);
});
