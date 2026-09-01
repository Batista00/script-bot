import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { ProviderCatalogRepository } from "../provider-catalog/provider-catalog.types.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import { validateCommercialInput } from "../products/product-inputs.js";
import { validateFulfillmentInput } from "../fulfillments/fulfillments.input.js";
import type { ProviderFulfillmentRegistry } from "../fulfillments/fulfillments.registry.js";
import type { DeliverySnapshot } from "./sales.types.js";

export class SalesDeliveryService {
  constructor(private readonly gateway: BotGatewayService, private readonly catalog: ProviderCatalogRepository,
    private readonly integrations: IntegrationsService, private readonly adapters: ProviderFulfillmentRegistry) {}

  async validate(businessId: string, productId: string, quantity: number, data: JsonObject): Promise<DeliverySnapshot> {
    const product = await this.gateway.getProduct(businessId,productId);
    const input = validateCommercialInput(product.requiredInputs,validateFulfillmentInput(data));
    if (!product.requiredInputs.length && Object.keys(input).length) {
      throw new AppError("El producto no acepta datos adicionales",400,"INVALID_PRODUCT_INPUTS");
    }
    const mapping = await this.catalog.findCurrentMapping(businessId,productId);
    if (!mapping) return { mode:"manual",productId,mappingId:null,providerServiceId:null,input };
    if (mapping.status !== "active") throw new AppError("La entrega de este producto está desactivada",409,"PRODUCT_NOT_AVAILABLE");
    const service = await this.catalog.findServiceById(businessId,mapping.providerServiceId);
    if (!service || service.providerStatus !== "active" || service.orderCapabilities?.supported !== true) {
      throw new AppError("Este servicio no está habilitado para venta automática",409,"PROVIDER_SERVICE_NOT_SUPPORTED");
    }
    if ((service.minQuantity !== null && quantity < service.minQuantity) || (service.maxQuantity !== null && quantity > service.maxQuantity)) {
      throw new AppError("La cantidad está fuera del rango admitido por el servicio",400,"PROVIDER_QUANTITY_NOT_SUPPORTED");
    }
    const integration = await this.integrations.getById(businessId,service.integrationId);
    if (integration.status !== "active") throw new AppError("Proveedor desactivado",409,"INTEGRATION_INACTIVE");
    const adapter = this.adapters.resolve(service.providerKey);
    if (!adapter?.validateOrder) throw new AppError("La entrega requiere configuración",409,"PROVIDER_SERVICE_NOT_SUPPORTED");
    try {
      adapter.validateOrder({businessId,integrationId:service.integrationId,externalServiceId:service.externalServiceId,
        serviceType:service.serviceType,quantity,fulfillmentInput:input});
    } catch {
      throw new AppError("Revisa los datos del servicio y la cantidad (un comentario por unidad)",400,"SALES_DELIVERY_INPUT_INVALID");
    }
    return {mode:"provider",productId,mappingId:mapping.id,providerServiceId:service.id,input};
  }
  async revalidate(businessId: string, quantity: number, snapshot: DeliverySnapshot): Promise<void> {
    const current = await this.validate(businessId,snapshot.productId,quantity,snapshot.input);
    if (current.mode!==snapshot.mode || current.mappingId!==snapshot.mappingId || current.providerServiceId!==snapshot.providerServiceId) {
      throw new AppError("La configuración de entrega cambió; requiere revisión humana",409,"DELIVERY_CONFIGURATION_CHANGED");
    }
  }
}
