import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export const providerServiceStatuses = ["active", "inactive"] as const;
export const providerMappingStatuses = ["active", "inactive"] as const;

export type ProviderServiceStatus = (typeof providerServiceStatuses)[number];
export type ProviderMappingStatus = (typeof providerMappingStatuses)[number];

export interface NormalizedProviderService {
  externalServiceId: string;
  name: string;
  category: string | null;
  serviceType: string | null;
  rate: string | null;
  rateCurrency: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  metadata: JsonObject;
}

export interface ProviderService extends NormalizedProviderService {
  id: string;
  businessId: string;
  integrationId: string;
  providerKey: string;
  providerStatus: ProviderServiceStatus;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderServiceListOptions {
  limit: number;
  offset: number;
  integrationId?: string;
  providerKey?: string;
  providerStatus?: ProviderServiceStatus;
  category?: string;
}

export interface ProviderServiceListQuery {
  limit?: string;
  offset?: string;
  integrationId?: string;
  providerKey?: string;
  providerStatus?: ProviderServiceStatus;
  category?: string;
}

export interface ProviderCatalogSyncResult {
  integrationId: string;
  providerKey: string;
  received: number;
  created: number;
  updated: number;
  deactivated: number;
}

export interface ProductProviderMapping {
  id: string;
  businessId: string;
  productId: string;
  providerServiceId: string;
  status: ProviderMappingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductProviderMappingInput { providerServiceId: string }

export interface UpdateProductProviderMappingInput {
  providerServiceId?: string;
  status?: ProviderMappingStatus;
}

export class ActiveProductMappingConflictError extends Error {}

export interface ProviderCatalogRepository {
  listServices(
    businessId: string,
    options: ProviderServiceListOptions,
  ): Promise<ProviderService[]>;
  findServiceById(businessId: string, providerServiceId: string): Promise<ProviderService | null>;
  listExternalServiceIds(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<string[]>;
  lockActiveIntegrationForSync(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean>;
  upsertServices(
    businessId: string,
    integrationId: string,
    providerKey: string,
    services: readonly NormalizedProviderService[],
    syncedAt: string,
    executor: DatabaseExecutor,
  ): Promise<void>;
  deactivateMissingServices(
    businessId: string,
    integrationId: string,
    receivedExternalIds: readonly string[],
    syncedAt: string,
    executor: DatabaseExecutor,
  ): Promise<number>;
  findCurrentMapping(
    businessId: string,
    productId: string,
    executor?: DatabaseExecutor,
  ): Promise<ProductProviderMapping | null>;
  createMapping(
    businessId: string,
    productId: string,
    providerServiceId: string,
    status: ProviderMappingStatus,
    executor?: DatabaseExecutor,
  ): Promise<ProductProviderMapping>;
  updateMappingStatus(
    businessId: string,
    mappingId: string,
    status: ProviderMappingStatus,
    executor?: DatabaseExecutor,
  ): Promise<ProductProviderMapping | null>;
}
