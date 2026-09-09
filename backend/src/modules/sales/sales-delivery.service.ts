import { AppError } from "../../core/errors/app-error.js";
import { isDeepStrictEqual } from "node:util";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { ProviderCatalogRepository } from "../provider-catalog/provider-catalog.types.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import { validateCommercialInput } from "../products/product-inputs.js";
import { validateFulfillmentInput } from "../fulfillments/fulfillments.input.js";
import type { ProviderFulfillmentRegistry } from "../fulfillments/fulfillments.registry.js";
import type { DeliverySnapshot } from "./sales.types.js";
import { resolvePhysicalDelivery, type DeliverySelection, type ManualShippingQuote } from "../products/physical-delivery.js";
import type { DigitalDeliveryService } from "../digital-delivery/digital-delivery.service.js";

export class SalesDeliveryService {
  constructor(private readonly gateway: BotGatewayService, private readonly catalog: ProviderCatalogRepository,
    private readonly integrations: IntegrationsService, private readonly adapters: ProviderFulfillmentRegistry,
    private readonly digital?:DigitalDeliveryService) {}

  async validate(businessId: string, productId: string, quantity: number, data: JsonObject,selection?:DeliverySelection,manualShipping?:ManualShippingQuote): Promise<DeliverySnapshot> {
    const product = await this.gateway.getProduct(businessId,productId);
    const input = validateCommercialInput(product.requiredInputs,validateFulfillmentInput(data));
    if (!product.requiredInputs.length && Object.keys(input).length) {
      throw new AppError("El producto no acepta datos adicionales",400,"INVALID_PRODUCT_INPUTS");
    }
    const physical=resolvePhysicalDelivery(product.deliveryConfig,selection,manualShipping);
    if(physical)return {mode:"manual",productId,mappingId:null,providerServiceId:null,input,physical};
    const mapping = await this.catalog.findCurrentMapping(businessId,productId);
    if (product.deliveryConfig?.processing === "manual") {
      return {mode:"manual",productId,mappingId:null,providerServiceId:null,input};
    }
    if (!mapping && product.deliveryConfig?.processing === "automatic") {
      if(product.deliveryConfig.kind==="digital"&&this.digital){
        const digitalContents=product.deliveryConfig.digitalContents??"downloads";
        await this.digital.available(businessId,productId,quantity,digitalContents);
        return {mode:"digital",productId,mappingId:null,providerServiceId:null,input,digitalContents};
      }
      throw new AppError("La entrega automática todavía no está configurada. Solicita un agente antes de pagar",409,"DELIVERY_NOT_CONFIGURED");
    }
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
  async reserveDigital(businessId:string,orderId:string):Promise<void>{
    if(!this.digital)throw new AppError("Entrega digital no configurada",409,"DELIVERY_NOT_CONFIGURED");
    await this.digital.reserve(businessId,orderId);
  }
  async revalidate(businessId: string, quantity: number, snapshot: DeliverySnapshot): Promise<void> {
    if(snapshot.items){
      for(const item of snapshot.items)await this.revalidate(businessId,item.quantity,item);
      return;
    }
    if(snapshot.mode==="digital"){
      const product=await this.gateway.getProduct(businessId,snapshot.productId);
      const mapping=await this.catalog.findCurrentMapping(businessId,snapshot.productId);
      if(mapping||product.deliveryConfig?.kind!=="digital"||product.deliveryConfig.processing!=="automatic"||
        (product.deliveryConfig.digitalContents??"downloads")!==snapshot.digitalContents){
        throw new AppError("La configuración digital cambió; solicite un agente",409,"DELIVERY_CONFIGURATION_CHANGED");
      }
      // License stock is reserved atomically when confirming, not counted again as free stock.
      return;
    }
    const physical=snapshot.physical;
    const current = await this.validate(businessId,snapshot.productId,quantity,snapshot.input,physical?{
      method:physical.method,...(physical.method==="shipping"?{address:physical.address,...(physical.zone?{zone:physical.zone}:{})}:{}),
    }:undefined,physical?.manualQuote);
    if (current.mode!==snapshot.mode || current.mappingId!==snapshot.mappingId || current.providerServiceId!==snapshot.providerServiceId) {
      throw new AppError("La configuración de entrega cambió; requiere revisión humana",409,"DELIVERY_CONFIGURATION_CHANGED");
    }
    if(!isDeepStrictEqual(current.physical??null,physical??null))throw new AppError("La modalidad o tarifa de entrega cambió; confirme un nuevo resumen antes de pagar",409,"DELIVERY_CONFIGURATION_CHANGED");
  }
}
