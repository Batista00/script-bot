import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export const providerServiceStatuses = ["active", "inactive"] as const;
export const providerMappingStatuses = ["active", "inactive"] as const;

export type ProviderServiceStatus = (typeof providerServiceStatuses)[number];
export type ProviderMappingStatus = (typeof providerMappingStatuses)[number];

export interface ProviderOrderField {
  key: string;
  providerField: string;
  type: "url" | "text" | "textarea" | "integer" | "date";
}

export interface ProviderOrderCapabilities {
  supported: boolean;
  required: ProviderOrderField[];
  optional: ProviderOrderField[];
  source?: "official" | "unverified";
  unsupportedReason?: string;
}

export interface NormalizedProviderService {
  externalServiceId: string;
  name: string;
  category: string | null;
  serviceType: string | null;
  rate: string | null;
  rateCurrency: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  providerDescription?: string | null;
  orderCapabilities?: ProviderOrderCapabilities;
  metadata: JsonObject;
}

export interface ProviderService extends NormalizedProviderService {
  id: string;
  businessId: string;
  integrationId: string;
  providerKey: string;
  providerStatus: ProviderServiceStatus;
  mappingCount?: number;
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
  externalServiceId?: string;
  serviceType?: string;
  search?: string;
  mappingStatus?: "mapped" | "unmapped";
}

export interface ProviderServiceListQuery {
  limit?: string;
  offset?: string;
  integrationId?: string;
  providerKey?: string;
  providerStatus?: ProviderServiceStatus;
  category?: string;
  externalServiceId?: string;
  serviceType?: string;
  search?: string;
  mappingStatus?: "mapped" | "unmapped";
}

export interface ProviderCatalogFetchResult {
  services: readonly NormalizedProviderService[];
  received: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
}

export interface ProviderBalance {
  balance: string;
  currency: string;
}

export interface ProviderCatalogSyncResult {
  integrationId: string;
  providerKey: string;
  received: number;
  normalized: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
}

export interface ProviderCatalogState {
  businessId: string;
  integrationId: string;
  connectionStatus: "unknown" | "ok" | "error";
  providerBalance: string | null;
  providerCurrency: string | null;
  servicesReceived: number;
  servicesNormalized: number;
  servicesRejected: number;
  rejectionReasons: Record<string, number>;
  lastSyncAt: string | null;
  lastBalanceAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
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
  findServiceById(
    businessId: string,
    providerServiceId: string,
    executor?: DatabaseExecutor,
  ): Promise<ProviderService | null>;
  listServiceIdentities(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<Array<{ externalServiceId: string; providerStatus: ProviderServiceStatus }>>;
  lockActiveIntegration(
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
  saveCatalogState(
    businessId: string,
    integrationId: string,
    input: Omit<ProviderCatalogState, "businessId" | "integrationId" | "updatedAt">,
    executor: DatabaseExecutor,
  ): Promise<void>;
  findCatalogState(
    businessId: string,
    integrationId: string,
  ): Promise<ProviderCatalogState | null>;
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
