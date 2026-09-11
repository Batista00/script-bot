import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { BusinessesRepository } from "../businesses/businesses.types.js";
import type { CategoriesRepository } from "../categories/categories.types.js";
import {
  normalizeCurrency,
  normalizeMoney,
  normalizePricingQuantity,
  validatePriceShape,
  validatePricingRange,
} from "../pricing/pricing.rules.js";
import {
  type PricingRepository,
  pricingTypes,
  type ProductPricePersistenceInput,
} from "../pricing/pricing.types.js";
import { normalizeCreateProductInput } from "../products/products.service.js";
import type { ProductInputField } from "../products/product-inputs.js";
import {
  ProductSkuConflictError,
  type ProductsRepository,
  productStatuses,
} from "../products/products.types.js";
import type {
  ImportProviderServiceInput,
  ImportProviderServiceResult,
} from "./provider-product-import.types.js";
import type { ProviderCatalogRepository } from "./provider-catalog.types.js";
import type { ProviderOrderCapabilities } from "./provider-catalog.types.js";

function skuConflict(): AppError {
  return new AppError(
    "Product SKU already exists in this business",
    409,
    "PRODUCT_SKU_CONFLICT",
  );
}

const fieldCopy: Record<string, { label: string; helpText: string | null }> = {
  targetUrl: { label: "Enlace de destino", helpText: "Ingresa el enlace de la publicación, perfil o recurso." },
  comments: { label: "Comentarios", helpText: "Escribe un comentario por línea." },
  username: { label: "Nombre de usuario", helpText: "Sin contraseña ni credenciales." },
  minimum: { label: "Cantidad mínima por publicación", helpText: null },
  maximum: { label: "Cantidad máxima por publicación", helpText: null },
  posts: { label: "Cantidad de publicaciones", helpText: null },
  delay: { label: "Demora", helpText: "Valor requerido por el proveedor." },
  expiry: { label: "Fecha de expiración", helpText: null },
  runs: { label: "Número de ejecuciones", helpText: null },
  interval: { label: "Intervalo en minutos", helpText: null },
};

export function defaultCommercialInputs(
  capabilities: ProviderOrderCapabilities,
): ProductInputField[] {
  if (!capabilities.supported) return [];
  return capabilities.required.map((providerField, position) => ({
    key: providerField.key,
    label: fieldCopy[providerField.key]?.label ?? providerField.key,
    helpText: fieldCopy[providerField.key]?.helpText ?? null,
    type: providerField.type,
    required: true,
    position,
    validation: providerField.type === "integer" ? { minimum: 0 }
      : { maxLength: providerField.type === "url" ? 2048 : 10_000 },
  }));
}

export class ProviderProductImportService {
  constructor(
    private readonly db: Pool,
    private readonly providerCatalog: ProviderCatalogRepository,
    private readonly categories: CategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly pricing: PricingRepository,
    private readonly businesses?: BusinessesRepository,
  ) {}

  async import(
    businessId: string,
    input: ImportProviderServiceInput,
  ): Promise<ImportProviderServiceResult> {
    if (!productStatuses.includes(input.status)) {
      throw new AppError("Invalid product status", 400, "INVALID_PRODUCT_STATUS");
    }
    if (!pricingTypes.includes(input.pricingType)) {
      throw new AppError("Invalid pricing type", 400, "INVALID_PRICING_TYPE");
    }
    const baseProductValues = {
      ...normalizeCreateProductInput(input),
      status: input.status,
    };
    const retailPrice = normalizeMoney(input.retailPrice, "retailPrice");
    if (retailPrice === null) {
      throw new AppError("retailPrice is required", 400, "INVALID_MONEY_AMOUNT");
    }
    const priceValues: ProductPricePersistenceInput = {
      pricingType: input.pricingType,
      currency: normalizeCurrency(input.currency),
      fixedPrice: input.pricingType === "fixed" ? retailPrice : null,
      unitPrice: input.pricingType === "unit" ? retailPrice : null,
      minQuantity: normalizePricingQuantity(input.minQuantity, "minQuantity"),
      maxQuantity: normalizePricingQuantity(input.maxQuantity, "maxQuantity"),
      status: input.status,
    };
    validatePriceShape(priceValues.pricingType, priceValues.fixedPrice, priceValues.unitPrice);
    validatePricingRange(priceValues.minQuantity, priceValues.maxQuantity);

    return withTransaction(this.db, async (client) => {
      const providerService = await this.providerCatalog.findServiceById(
        businessId,
        input.providerServiceId,
        client,
      );
      if (!providerService) {
        throw new AppError("Provider service not found", 404, "PROVIDER_SERVICE_NOT_FOUND");
      }
      if (this.businesses) {
        const business = await this.businesses.findById(businessId, client);
        if (!business) throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
        if (priceValues.currency !== business.currency) {
          throw new AppError(
            "Retail price currency must match the business currency",
            409,
            "BUSINESS_CURRENCY_MISMATCH",
          );
        }
      }
      if (providerService.providerStatus !== "active") {
        throw new AppError("Provider service is inactive", 409, "PROVIDER_SERVICE_INACTIVE");
      }
      if (input.status === "active" && providerService.orderCapabilities?.supported !== true) {
        throw new AppError("Importa este servicio como inactivo: su envío no está soportado", 409, "PROVIDER_SERVICE_NOT_SUPPORTED");
      }
      const productValues = {
        ...baseProductValues,
        requiredInputs: input.requiredInputs === undefined
          ? defaultCommercialInputs(providerService.orderCapabilities ?? {
            supported: false, required: [], optional: [], source: "unverified",
          })
          : (baseProductValues.requiredInputs ?? []),
      };
      if (!await this.providerCatalog.lockActiveIntegration(
        businessId,
        providerService.integrationId,
        client,
      )) {
        throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
      }
      if (
        productValues.categoryId !== null &&
        !await this.categories.findById(businessId, productValues.categoryId, client)
      ) {
        throw new AppError("Category not found", 404, "CATEGORY_NOT_FOUND");
      }
      if (
        productValues.sku !== null &&
        await this.products.findBySku(businessId, productValues.sku, undefined, client)
      ) {
        throw skuConflict();
      }

      try {
        const product = await this.products.create(businessId, productValues, client);
        const price = await this.pricing.create(businessId, product.id, priceValues, client);
        const mapping = await this.providerCatalog.createMapping(
          businessId,
          product.id,
          providerService.id,
          input.status,
          client,
        );
        return { product, price, mapping };
      } catch (error) {
        if (error instanceof ProductSkuConflictError) throw skuConflict();
        throw error;
      }
    });
  }
}
