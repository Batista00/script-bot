import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { DatabaseExecutor } from "../../src/core/database/database.js";
import {
  ActiveProductMappingConflictError,
  type NormalizedProviderService,
  type ProductProviderMapping,
  type ProviderCatalogRepository,
  type ProviderMappingStatus,
  type ProviderService,
  type ProviderServiceListOptions,
} from "../../src/modules/provider-catalog/provider-catalog.types.js";

export const catalogNow = "2026-08-18T12:00:00.000Z";
export const catalogBusinessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
export const catalogBusinessB = "533b75fa-76af-4756-ac9f-e2d1ee1d11af";
export const catalogIntegrationA = "5e7b4b23-00e9-4a1c-bcf7-f33eb5710ad8";
export const catalogIntegrationB = "eb55af44-5971-412f-89a9-1b80f9707775";
export const catalogProductA = "2434e937-20e5-4b78-a422-b397c8bcba3f";
export const catalogProductB = "097c28d0-ec18-416d-81a3-0077395d8289";

function clone<T>(value: T): T { return structuredClone(value); }

export class MemoryProviderCatalogRepository implements ProviderCatalogRepository {
  readonly services: ProviderService[] = [];
  readonly mappings: ProductProviderMapping[] = [];
  private snapshot: { services: ProviderService[]; mappings: ProductProviderMapping[] } | undefined;

  begin(): void {
    this.snapshot = { services: clone(this.services), mappings: clone(this.mappings) };
  }
  commit(): void { this.snapshot = undefined; }
  rollback(): void {
    if (!this.snapshot) return;
    this.services.splice(0, this.services.length, ...this.snapshot.services);
    this.mappings.splice(0, this.mappings.length, ...this.snapshot.mappings);
    this.snapshot = undefined;
  }

  async listServices(businessId: string, options: ProviderServiceListOptions): Promise<ProviderService[]> {
    return this.services.filter((service) => service.businessId === businessId &&
      (options.integrationId === undefined || service.integrationId === options.integrationId) &&
      (options.providerKey === undefined || service.providerKey === options.providerKey) &&
      (options.providerStatus === undefined || service.providerStatus === options.providerStatus) &&
      (options.category === undefined || service.category === options.category))
      .slice(options.offset, options.offset + options.limit).map(clone);
  }

  async findServiceById(businessId: string, providerServiceId: string): Promise<ProviderService | null> {
    const service = this.services.find((item) =>
      item.businessId === businessId && item.id === providerServiceId);
    return service ? clone(service) : null;
  }

  async listExternalServiceIds(
    businessId: string,
    integrationId: string,
    _executor: DatabaseExecutor,
  ): Promise<string[]> {
    return this.services.filter((service) => service.businessId === businessId &&
      service.integrationId === integrationId).map((service) => service.externalServiceId);
  }

  async lockActiveIntegrationForSync(): Promise<boolean> { return true; }

  async upsertServices(
    businessId: string,
    integrationId: string,
    providerKey: string,
    services: readonly NormalizedProviderService[],
    syncedAt: string,
    _executor: DatabaseExecutor,
  ): Promise<void> {
    for (const input of services) {
      const existing = this.services.find((service) => service.businessId === businessId &&
        service.integrationId === integrationId &&
        service.externalServiceId === input.externalServiceId);
      if (existing) {
        Object.assign(existing, clone(input), {
          providerKey, providerStatus: "active", lastSyncedAt: syncedAt, updatedAt: syncedAt,
        });
      } else {
        this.services.push({
          id: randomUUID(), businessId, integrationId, providerKey, ...clone(input),
          providerStatus: "active", lastSyncedAt: syncedAt,
          createdAt: syncedAt, updatedAt: syncedAt,
        });
      }
    }
  }

  async deactivateMissingServices(
    businessId: string,
    integrationId: string,
    receivedExternalIds: readonly string[],
    syncedAt: string,
    _executor: DatabaseExecutor,
  ): Promise<number> {
    let count = 0;
    for (const service of this.services) {
      if (service.businessId === businessId && service.integrationId === integrationId &&
        service.providerStatus === "active" &&
        !receivedExternalIds.includes(service.externalServiceId)) {
        service.providerStatus = "inactive";
        service.lastSyncedAt = syncedAt;
        service.updatedAt = syncedAt;
        count += 1;
      }
    }
    return count;
  }

  async findCurrentMapping(
    businessId: string,
    productId: string,
  ): Promise<ProductProviderMapping | null> {
    const matches = this.mappings.filter((mapping) =>
      mapping.businessId === businessId && mapping.productId === productId)
      .sort((left, right) => Number(right.status === "active") - Number(left.status === "active"));
    return matches[0] ? clone(matches[0]) : null;
  }

  async createMapping(
    businessId: string,
    productId: string,
    providerServiceId: string,
    status: ProviderMappingStatus,
  ): Promise<ProductProviderMapping> {
    if (status === "active" && this.mappings.some((mapping) =>
      mapping.businessId === businessId && mapping.productId === productId &&
      mapping.status === "active")) {
      throw new ActiveProductMappingConflictError();
    }
    const mapping = {
      id: randomUUID(), businessId, productId, providerServiceId, status,
      createdAt: catalogNow, updatedAt: catalogNow,
    };
    this.mappings.push(mapping);
    return clone(mapping);
  }

  async updateMappingStatus(
    businessId: string,
    mappingId: string,
    status: ProviderMappingStatus,
  ): Promise<ProductProviderMapping | null> {
    const mapping = this.mappings.find((item) =>
      item.businessId === businessId && item.id === mappingId);
    if (!mapping) return null;
    if (status === "active" && this.mappings.some((item) => item.id !== mapping.id &&
      item.businessId === businessId && item.productId === mapping.productId &&
      item.status === "active")) {
      throw new ActiveProductMappingConflictError();
    }
    mapping.status = status;
    mapping.updatedAt = catalogNow;
    return clone(mapping);
  }
}

class MemoryClient {
  constructor(
    private readonly repository: MemoryProviderCatalogRepository,
    private readonly state: { inTransaction: boolean },
  ) {}
  async query(command: string): Promise<{ rows: never[] }> {
    if (command === "BEGIN") {
      this.state.inTransaction = true;
      this.repository.begin();
    }
    if (command === "COMMIT") {
      this.repository.commit();
      this.state.inTransaction = false;
    }
    if (command === "ROLLBACK") {
      this.repository.rollback();
      this.state.inTransaction = false;
    }
    return { rows: [] };
  }
  release(): void {}
}

export function createMemoryPool(repository: MemoryProviderCatalogRepository): {
  pool: Pool;
  state: { inTransaction: boolean };
} {
  const state = { inTransaction: false };
  const pool = {
    connect: async () => new MemoryClient(repository, state),
  } as unknown as Pool;
  return { pool, state };
}

export function normalizedService(
  externalServiceId: string,
  overrides: Partial<NormalizedProviderService> = {},
): NormalizedProviderService {
  return {
    externalServiceId,
    name: `Service ${externalServiceId}`,
    category: "Social",
    serviceType: "Default",
    rate: "0.12500000",
    rateCurrency: null,
    minQuantity: 10,
    maxQuantity: 10_000,
    metadata: {},
    ...overrides,
  };
}
