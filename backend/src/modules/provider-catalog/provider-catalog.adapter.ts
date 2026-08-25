import type {
  NormalizedProviderService,
  ProviderBalance,
  ProviderCatalogFetchResult,
} from "./provider-catalog.types.js";

export interface ProviderCatalogAdapter {
  readonly key: string;
  listServices(
    businessId: string,
  ): Promise<ProviderCatalogFetchResult | readonly NormalizedProviderService[]>;
  getBalance?(businessId: string): Promise<ProviderBalance>;
}

export class ProviderTemporarilyUnavailableError extends Error {}
export class ProviderResponseInvalidError extends Error {}
export class ProviderRequestRejectedError extends Error {}
export class ProviderCatalogUnavailableError extends Error {}
