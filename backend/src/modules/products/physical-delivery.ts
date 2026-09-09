import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";
import type { ProductDelivery } from "./product-delivery.js";

export const deliverySelectionSchema=z.object({
  method:z.enum(["shipping","pickup"]),
  address:z.string().trim().min(8).max(500).optional(),
  zone:z.string().trim().min(1).max(120).optional(),
}).strict();
export type DeliverySelection=z.infer<typeof deliverySelectionSchema>;
export interface ManualShippingQuote {fee:number;quotedBy:string;quotedAt:string}
export interface PhysicalDelivery {
  manualQuote?: ManualShippingQuote;
  method:"shipping"|"pickup";
  address:string;
  zone:string|null;
  fee:number;
  instructions:string;
}

/** The customer chooses a configured method/zone, never the amount to charge. */
export function resolvePhysicalDelivery(config:ProductDelivery|null|undefined,selection?:DeliverySelection,manualQuote?:ManualShippingQuote):PhysicalDelivery|null {
  if(manualQuote){
    if(!z.object({fee:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),quotedBy:z.string().uuid(),quotedAt:z.string().datetime()}).strict().safeParse(manualQuote).success)
      throw new AppError("Cotización manual inválida",400,"INVALID_SHIPPING_QUOTE");
    if(config?.kind!=="physical"||config.shipping?.mode!=="quote"||selection?.method!=="shipping")
      throw new AppError("Sólo se cotiza manualmente un despacho configurado por cotizar",409,"INVALID_SHIPPING_QUOTE");
  }
  if(config?.kind!=="physical"){
    if(selection)throw new AppError("Este producto no admite despacho físico",400,"DELIVERY_METHOD_INVALID");
    return null;
  }
  const parsed=deliverySelectionSchema.safeParse(selection);
  if(!parsed.success)throw new AppError("Indica la modalidad de entrega y los datos solicitados antes del pago",409,"DELIVERY_SELECTION_REQUIRED");
  const value=parsed.data;
  if(!config.methods.includes(value.method))throw new AppError("Modalidad no disponible para este producto",409,"DELIVERY_METHOD_INVALID");
  if(value.method==="pickup"){
    if(value.address||value.zone)throw new AppError("Para retirar usamos la dirección del local configurado",400,"DELIVERY_METHOD_INVALID");
    if(!config.pickupAddress)throw new AppError("Un agente debe confirmar el punto de retiro antes del pago",409,"DELIVERY_REQUIRES_REVIEW");
    return {method:"pickup",address:config.pickupAddress,zone:null,fee:0,instructions:config.instructions};
  }
  if(!value.address)throw new AppError("Envíame la dirección completa para el despacho a domicilio",409,"DELIVERY_ADDRESS_REQUIRED");
  const tariff=config.shipping;
  if(tariff?.mode==="quote"&&manualQuote)return {method:"shipping",address:value.address,zone:value.zone??null,fee:manualQuote.fee,instructions:config.instructions,manualQuote};
  if(!tariff||tariff.mode==="quote")throw new AppError("Un agente debe cotizar y confirmar el costo de envío antes del pago",409,"DELIVERY_REQUIRES_REVIEW");
  let fee:number,zone:string|null=null;
  if(tariff.mode==="zones"){
    const found=tariff.zones.find(item=>item.name.toLocaleLowerCase("es")===value.zone?.toLocaleLowerCase("es"));
    if(!found)throw new AppError("Selecciona una de las zonas de despacho disponibles; si no corresponde, solicita un agente",409,"DELIVERY_ZONE_REQUIRED");
    fee=found.fee;zone=found.name;
  }else{
    if(value.zone)throw new AppError("Esta modalidad tiene tarifa fija, no una zona tarifaria",400,"DELIVERY_METHOD_INVALID");
    fee=tariff.fee;
  }
  return {method:"shipping",address:value.address,zone,fee,instructions:config.instructions};
}

export const deliverySelectionHttpSchema={type:"object",additionalProperties:false,required:["method"],properties:{
  method:{type:"string",enum:["shipping","pickup"]},address:{type:"string",minLength:8,maxLength:500},zone:{type:"string",minLength:1,maxLength:120},
}} as const;
export const physicalDeliveryHttpSchema={anyOf:[{type:"null"},{type:"object",additionalProperties:false,required:["method","address","zone","fee","instructions"],properties:{
  method:{type:"string",enum:["shipping","pickup"]},address:{type:"string",maxLength:500},zone:{anyOf:[{type:"string",maxLength:120},{type:"null"}]},
  fee:{type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER},instructions:{type:"string",maxLength:2000},
  manualQuote:{type:"object",additionalProperties:false,required:["fee","quotedBy","quotedAt"],properties:{fee:{type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER},quotedBy:{type:"string",format:"uuid"},quotedAt:{type:"string",format:"date-time"}}},
}}]} as const;
