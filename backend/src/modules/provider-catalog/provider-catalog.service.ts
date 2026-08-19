import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { ProductsRepository } from "../products/products.types.js";
import {
  ProviderCatalogUnavailableError,
  ProviderResponseInvalidError,
  ProviderTemporarilyUnavailableError,
} from "./provider-catalog.adapter.js";
import { ProviderCatalogRegistry, normalizeCatalogProviderKey } from "./provider-catalog.registry.js";
import {
  ActiveProductMappingConflictError,
  type CreateProductProviderMappingInput,
  type NormalizedProviderService,
  type ProductProviderMapping,
  type ProviderCatalogRepository,
  type ProviderCatalogSyncResult,
  type ProviderService,
  type ProviderServiceListOptions,
  type UpdateProductProviderMappingInput,
} from "./provider-catalog.types.js";

function mappingConflict(): AppError {
  return new AppError(
    "Product already has an active provider mapping",
    409,
    "PRODUCT_PROVIDER_MAPPING_ALREADY_ACTIVE",
  );
}

export class ProviderCatalogService {
  constructor(
    private readonly repository: ProviderCatalogRepository,
    private readonly db: Pool,
    private readonly integrations: Pick<IntegrationsService, "getById">,
    private readonly products: Pick<ProductsRepository, "findById">,
    private readonly adapters: ProviderCatalogRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listServices(
    businessId: string,
    options: ProviderServiceListOptions,
  ): Promise<ProviderService[]> {
    let providerKey: string | undefined;
    try {
      providerKey = options.providerKey === undefined
        ? undefined
        : normalizeCatalogProviderKey(options.providerKey);
    } catch {
      throw new AppError("Invalid provider key", 400, "INVALID_PROVIDER_KEY");
    }
    return this.repository.listServices(businessId, {
      ...options,
      ...(providerKey === undefined ? {} : { providerKey }),
    });
  }

  async getServiceById(businessId: string, providerServiceId: string): Promise<ProviderService> {
    const service = await this.repository.findServiceById(businessId, providerServiceId);
    if (!service) {
      throw new AppError("Provider service not found", 404, "PROVIDER_SERVICE_NOT_FOUND");
    }
    return service;
  }

  async sync(businessId: string, integrationId: string): Promise<ProviderCatalogSyncResult> {
    const integration = await this.integrations.getById(businessId, integrationId);
    if (integration.status !== "active") {
      throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
    }
    const adapter = this.adapters.resolve(integration.providerKey);
    if (!adapter) {
      throw new AppError(
        "Provider catalog is not available",
        503,
        "PROVIDER_CATALOG_NOT_AVAILABLE",
      );
    }

    let services: readonly NormalizedProviderService[];
    try {
      services = await adapter.listServices(businessId);
      this.assertUniqueExternalIds(services);
    } catch (error) {
      if (error instanceof ProviderCatalogUnavailableError) {
        throw new AppError(
          "Provider catalog is not available",
          503,
          "PROVIDER_CATALOG_NOT_AVAILABLE",
        );
      }
      if (error instanceof ProviderTemporarilyUnavailableError) {
        throw new AppError(
          "Provider is temporarily unavailable",
          503,
          "PROVIDER_TEMPORARILY_UNAVAILABLE",
        );
      }
      if (error instanceof ProviderResponseInvalidError) {
        throw new AppError("Provider response is invalid", 502, "PROVIDER_RESPONSE_INVALID");
      }
      throw error;
    }

    const syncedAt = this.now().toISOString();
    return withTransaction(this.db, async (client) => {
      const locked = await this.repository.lockActiveIntegrationForSync(
        businessId,
        integrationId,
        client,
      );
      if (!locked) {
        throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
      }
      const existingIds = new Set(await this.repository.listExternalServiceIds(
        businessId,
        integrationId,
        client,
      ));
      await this.repository.upsertServices(
        businessId,
        integrationId,
        integration.providerKey,
        services,
        syncedAt,
        client,
      );
      const externalIds = services.map((service) => service.externalServiceId);
      const deactivated = await this.repository.deactivateMissingServices(
        businessId,
        integrationId,
        externalIds,
        syncedAt,
        client,
      );
      const created = externalIds.filter((externalId) => !existingIds.has(externalId)).length;
      return {
        integrationId,
        providerKey: integration.providerKey,
        received: services.length,
        created,
        updated: services.length - created,
        deactivated,
      };
    });
  }

  async getMapping(businessId: string, productId: string): Promise<ProductProviderMapping> {
    await this.requireProduct(businessId, productId);
    const mapping = await this.repository.findCurrentMapping(businessId, productId);
    if (!mapping) {
      throw new AppError(
        "Product provider mapping not found",
        404,
        "PRODUCT_PROVIDER_MAPPING_NOT_FOUND",
      );
    }
    return mapping;
  }

  async createMapping(
    businessId: string,
    productId: string,
    input: CreateProductProviderMappingInput,
  ): Promise<ProductProviderMapping> {
    await this.requireProduct(businessId, productId);
    await this.requireUsableProviderService(businessId, input.providerServiceId);
    try {
      return await this.repository.createMapping(
        businessId,
        productId,
        input.providerServiceId,
        "active",
      );
    } catch (error) {
      if (error instanceof ActiveProductMappingConflictError) throw mappingConflict();
      throw error;
    }
  }

  async updateMapping(
    businessId: string,
    productId: string,
    input: UpdateProductProviderMappingInput,
  ): Promise<ProductProviderMapping> {
    await this.requireProduct(businessId, productId);
    const current = await this.repository.findCurrentMapping(businessId, productId);
    if (!current) {
      throw new AppError(
        "Product provider mapping not found",
        404,
        "PRODUCT_PROVIDER_MAPPING_NOT_FOUND",
      );
    }
    const providerServiceId = input.providerServiceId ?? current.providerServiceId;
    const status = input.status ?? current.status;
    if (status === "active") {
      await this.requireUsableProviderService(businessId, providerServiceId);
    } else if (input.providerServiceId !== undefined) {
      await this.getServiceById(businessId, providerServiceId);
    }

    try {
      if (providerServiceId === current.providerServiceId) {
        const updated = await this.repository.updateMappingStatus(
          businessId,
          current.id,
          status,
        );
        if (!updated) {
          throw new AppError(
            "Product provider mapping not found",
            404,
            "PRODUCT_PROVIDER_MAPPING_NOT_FOUND",
          );
        }
        return updated;
      }
      return await withTransaction(this.db, async (client) => {
        if (current.status === "active") {
          const deactivated = await this.repository.updateMappingStatus(
            businessId,
            current.id,
            "inactive",
            client,
          );
          if (!deactivated) {
            throw new AppError(
              "Product provider mapping not found",
              404,
              "PRODUCT_PROVIDER_MAPPING_NOT_FOUND",
            );
          }
        }
        return this.repository.createMapping(
          businessId,
          productId,
          providerServiceId,
          status,
          client,
        );
      });
    } catch (error) {
      if (error instanceof ActiveProductMappingConflictError) throw mappingConflict();
      throw error;
    }
  }

  private async requireProduct(businessId: string, productId: string): Promise<void> {
    if (!await this.products.findById(businessId, productId)) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
  }

  private async requireUsableProviderService(
    businessId: string,
    providerServiceId: string,
  ): Promise<void> {
    const service = await this.getServiceById(businessId, providerServiceId);
    if (service.providerStatus !== "active") {
      throw new AppError("Provider service is inactive", 409, "PROVIDER_SERVICE_INACTIVE");
    }
    const integration = await this.integrations.getById(businessId, service.integrationId);
    if (integration.status !== "active") {
      throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
    }
  }

  private assertUniqueExternalIds(services: readonly NormalizedProviderService[]): void {
    const ids = new Set<string>();
    for (const service of services) {
      if (ids.has(service.externalServiceId)) throw new ProviderResponseInvalidError();
      ids.add(service.externalServiceId);
    }
  }
}
