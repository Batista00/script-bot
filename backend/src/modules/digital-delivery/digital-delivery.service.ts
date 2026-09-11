import { createHash } from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";
import type { ProductsService } from "../products/products.service.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { IntegrationCredentialsCrypto } from "../integrations/integrations.crypto.js";
import type { PostgresNotificationsRepository } from "../automation/notifications.repository.js";
import type { PostgresDigitalDeliveryRepository } from "./digital-delivery.repository.js";
import { digitalAssetInputSchema,type DigitalAssetInput,type DigitalContents } from "./digital-delivery.schema.js";

export class DigitalDeliveryService {
  constructor(private readonly repository:PostgresDigitalDeliveryRepository,private readonly products:ProductsService,
    private readonly gateway:BotGatewayService,private readonly crypto:IntegrationCredentialsCrypto,private readonly notifications:PostgresNotificationsRepository){}
  private async product(businessId:string,productId:string){
    const product=await this.products.getById(businessId,productId);
    if(product.deliveryConfig?.kind!=="digital")throw new AppError("Configure primero este producto como digital",409,"DIGITAL_PRODUCT_REQUIRED");
    return product;
  }
  async list(businessId:string,productId:string){await this.product(businessId,productId);return this.repository.list(businessId,productId);}
  async add(businessId:string,productId:string,input:DigitalAssetInput){
    await this.product(businessId,productId);
    const parsed=digitalAssetInputSchema.safeParse(input);if(!parsed.success)throw new AppError("Revise el enlace HTTPS o licencia",400,"INVALID_DIGITAL_ASSET");
    const asset=parsed.data;
    return this.repository.add(businessId,productId,asset.kind,asset.label,this.crypto.encrypt({value:asset.value},businessId,"digital_asset"),
      createHash("sha256").update(businessId+":"+asset.value).digest("hex"));
  }
  async status(businessId:string,productId:string,id:string,status:"active"|"inactive"){
    await this.product(businessId,productId);await this.repository.status(businessId,productId,id,status);return {ok:true};
  }
  async available(businessId:string,productId:string,quantity:number,contents:DigitalContents){
    const available=await this.repository.available(businessId,productId);
    if((contents!=="licenses"&&!available.downloads)||(contents!=="downloads"&&available.licenses<quantity))throw new AppError("La entrega digital todavía no tiene archivos o licencias disponibles. Solicite ventas antes de pagar",409,"DIGITAL_ASSETS_UNAVAILABLE");
  }
  async reserve(businessId:string,orderId:string){
    const order=await this.gateway.getOrder(businessId,orderId);
    const items=[];
    for(const item of order.items){
      const product=await this.product(businessId,item.productId);
      if(product.deliveryConfig?.processing!=="automatic")throw new AppError("La entrega digital no está automatizada",409,"DIGITAL_DELIVERY_DISABLED");
      items.push({productId:item.productId,productName:item.productName,quantity:item.quantity,contents:product.deliveryConfig.digitalContents??"downloads"});
    }
    const allocation=await this.repository.reserve(businessId,orderId,items);
    // Validate size before allowing payment; the private preview is never returned to the caller.
    this.render(businessId,await this.repository.content(businessId,allocation.id,true));
    return allocation;
  }
  async enqueue(businessId:string,orderId:string,contact:string){
    const order=await this.gateway.getOrder(businessId,orderId);
    if(!["paid","processing"].includes(order.status))throw new AppError("El pago aún no está confirmado",409,"DIGITAL_PAYMENT_REQUIRED");
    const allocation=await this.repository.allocation(businessId,orderId)??await this.reserve(businessId,orderId);
    // Only a reference enters the queue, never unencrypted codes or private download links.
    await this.notifications.enqueue(businessId,`digital:${allocation.id}`,"whatsapp",{contact,digitalDeliveryId:allocation.id});
  }
  async content(businessId:string,id:string){
    return this.render(businessId,await this.repository.content(businessId,id));
  }
  private render(businessId:string,{allocation,rows}:Awaited<ReturnType<PostgresDigitalDeliveryRepository["content"]>>){
    const parts=allocation.assets.map(reference=>{
      const row=rows.find(a=>a.id===reference.id);if(!row)throw new AppError("Falta contenido reservado para esta entrega",409,"DIGITAL_ASSETS_UNAVAILABLE");
      const value=this.crypto.decrypt(row.valueEncrypted,businessId,"digital_asset").value;
      if(typeof value!=="string")throw new AppError("No se pudo leer el contenido digital",409,"DIGITAL_ASSET_INVALID");
      return `${reference.productName} · ${row.label}\n${value}`;
    });
    const text="Su pago está confirmado. Aquí tiene su compra digital:\n\n"+parts.join("\n\n");
    if(text.length>8000||Buffer.byteLength(JSON.stringify(text),"utf8")>24000)throw new AppError("La entrega necesita asistencia del equipo por su extensión",409,"DIGITAL_DELIVERY_TOO_LARGE");
    return text;
  }
  reconcile(businessId:string){return this.repository.reconcile(businessId);}
}
