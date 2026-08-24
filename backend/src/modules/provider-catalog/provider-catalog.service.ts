import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { ProductsRepository } from "../products/products.types.js";
import {
  ProviderCatalogUnavailableError,
  ProviderRequestRejectedError,
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
  type ProviderCatalogState,
  type ProviderCatalogSyncResult,
  type ProviderService,
  type ProviderServiceListOptions,
  type UpdateProductProviderMappingInput,
} from "./provider-catalog.types.js";

export interface ProviderCatalogSyncFailure {
  businessId: string;
  integrationId: string;
  providerKey: string;
  failureCode: string;
}

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
    private readonly reportFailure?: (failure: ProviderCatalogSyncFailure) => void,
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
    const externalServiceId = options.externalServiceId?.trim();
    if (
      externalServiceId !== undefined &&
      (externalServiceId.length === 0 || externalServiceId.length > 64 ||
        !/^[A-Za-z0-9_-]+$/.test(externalServiceId))
    ) {
      throw new AppError("Invalid external service id", 400, "INVALID_EXTERNAL_SERVICE_ID");
    }
    const serviceType = options.serviceType?.trim();
    if (serviceType !== undefined && (serviceType.length === 0 || serviceType.length > 255)) {
      throw new AppError("Invalid provider service type", 400, "INVALID_PROVIDER_SERVICE_TYPE");
    }
    const searchInput = options.search?.trim();
    if (searchInput !== undefined && (searchInput.length === 0 || searchInput.length > 160)) {
      throw new AppError("Invalid provider service search", 400, "INVALID_PROVIDER_SERVICE_SEARCH");
    }
    const search = searchInput?.replace(/[\\%_]/g, "\\$&");
    return this.repository.listServices(businessId, {
      ...options,
      ...(providerKey === undefined ? {} : { providerKey }),
      ...(externalServiceId === undefined ? {} : { externalServiceId }),
      ...(serviceType === undefined ? {} : { serviceType }),
      ...(search === undefined ? {} : { search: `%${search}%` }),
    });
  }

  async getCatalogState(
    businessId: string,
    integrationId: string,
  ): Promise<ProviderCatalogState | null> {
    await this.integrations.getById(businessId, integrationId);
    return this.repository.findCatalogState(businessId, integrationId);
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
    let received: number;
    let rejected: number;
    let rejectionReasons: Record<string, number>;
    let balance: { balance: string | null; currency: string | null };
    try {
      const [catalogResult, providerBalance] = await Promise.all([
        adapter.listServices(businessId),
        adapter.getBalance?.(businessId) ?? Promise.resolve(null),
      ]);
      const catalog = Array.isArray(catalogResult)
        ? { services: catalogResult as readonly NormalizedProviderService[],
          received: catalogResult.length, rejected: 0, rejectionReasons: {} }
        : catalogResult as import("./provider-catalog.types.js").ProviderCatalogFetchResult;
      services = catalog.services;
      received = catalog.received;
      rejected = catalog.rejected;
      rejectionReasons = catalog.rejectionReasons;
      balance = providerBalance ?? { balance: null, currency: null };
      this.assertUniqueExternalIds(services);
    } catch (error) {
      let mappedError: AppError | undefined;
      if (error instanceof ProviderCatalogUnavailableError) {
        mappedError = new AppError(
          "Provider catalog is not available",
          503,
          "PROVIDER_CATALOG_NOT_AVAILABLE",
        );
      } else if (error instanceof ProviderTemporarilyUnavailableError) {
        mappedError = new AppError(
          "Provider is temporarily unavailable",
          503,
          "PROVIDER_TEMPORARILY_UNAVAILABLE",
        );
      } else if (error instanceof ProviderRequestRejectedError) {
        mappedError = new AppError(
          "Provider rejected the catalog request",
          502,
          "PROVIDER_REQUEST_REJECTED",
        );
      } else if (error instanceof ProviderResponseInvalidError) {
        mappedError = new AppError(
          "Provider response is invalid",
          502,
          "PROVIDER_RESPONSE_INVALID",
        );
      }
      if (mappedError) {
        this.reportFailure?.({
          businessId,
          integrationId,
          providerKey: integration.providerKey,
          failureCode: mappedError.code,
        });
        await this.recordFailure(businessId, integrationId, mappedError.code);
        throw mappedError;
      }
      throw error;
    }

    const syncedAt = this.now().toISOString();
    return withTransaction(this.db, async (client) => {
      const locked = await this.repository.lockActiveIntegration(
        businessId,
        integrationId,
        client,
      );
      if (!locked) {
        throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
      }
      const existing = await this.repository.listServiceIdentities(
        businessId,
        integrationId,
        client,
      );
      const existingById = new Map(existing.map((item) => [item.externalServiceId, item]));
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
      const created = externalIds.filter((externalId) => !existingById.has(externalId)).length;
      const reactivated = externalIds.filter((externalId) =>
        existingById.get(externalId)?.providerStatus === "inactive").length;
      const updated = services.length - created - reactivated;
      await this.repository.saveCatalogState(businessId, integrationId, {
        connectionStatus: "ok",
        providerBalance: balance.balance,
        providerCurrency: balance.currency,
        servicesReceived: received,
        servicesNormalized: services.length,
        servicesRejected: rejected,
        rejectionReasons,
        lastSyncAt: syncedAt,
        lastBalanceAt: syncedAt,
        lastErrorCode: null,
      }, client);
      return {
        integrationId,
        providerKey: integration.providerKey,
        received,
        normalized: services.length,
        rejected,
        rejectionReasons,
        created,
        updated,
        reactivated,
        deactivated,
      };
    });
  }

  private async recordFailure(
    businessId: string,
    integrationId: string,
    errorCode: string,
  ): Promise<void> {
    const existing = await this.repository.findCatalogState(businessId, integrationId);
    await withTransaction(this.db, (client) => this.repository.saveCatalogState(
      businessId,
      integrationId,
      {
        connectionStatus: "error",
        providerBalance: existing?.providerBalance ?? null,
        providerCurrency: existing?.providerCurrency ?? null,
        servicesReceived: existing?.servicesReceived ?? 0,
        servicesNormalized: existing?.servicesNormalized ?? 0,
        servicesRejected: existing?.servicesRejected ?? 0,
        rejectionReasons: existing?.rejectionReasons ?? {},
        lastSyncAt: existing?.lastSyncAt ?? null,
        lastBalanceAt: existing?.lastBalanceAt ?? null,
        lastErrorCode: errorCode,
      },
      client,
    ));
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
