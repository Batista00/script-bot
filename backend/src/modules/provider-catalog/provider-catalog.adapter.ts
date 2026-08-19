import type { NormalizedProviderService } from "./provider-catalog.types.js";

export interface ProviderCatalogAdapter {
  readonly key: string;
  listServices(businessId: string): Promise<readonly NormalizedProviderService[]>;
}

export class ProviderTemporarilyUnavailableError extends Error {}
export class ProviderResponseInvalidError extends Error {}
export class ProviderCatalogUnavailableError extends Error {}
