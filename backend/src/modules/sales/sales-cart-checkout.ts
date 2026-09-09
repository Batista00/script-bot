import { isDeepStrictEqual } from "node:util";
import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesDeliveryService } from "./sales-delivery.service.js";
import type { SalesSession, SalesReply, DeliverySnapshot } from "./sales.types.js";
import { selectedCartItem } from "./sales-cart.js";
import { formatMoney } from "./sales-catalog.js";
import type { ManualShippingQuote } from "../products/physical-delivery.js";

export async function quoteSalesCart(session:SalesSession,repository:PostgresSalesRepository,gateway:BotGatewayService,deliveryService:SalesDeliveryService,manualShipping?:ManualShippingQuote):Promise<SalesReply> {
  const current=selectedCartItem(session),selections=[current,...(session.state.cart??[])];
  if(new Set(selections.map(i=>i.product.productId)).size!==selections.length)throw new AppError("Modifique la cantidad del producto repetido",409,"DUPLICATE_CART_PRODUCT");
  if(current.product.deliveryConfig?.kind==="physical"&&!current.deliverySelection){
    session.state.phase="delivery";
    return {text:"Antes del resumen, elija "+current.product.deliveryConfig.methods.map(m=>m==="shipping"?"despacho a domicilio (necesitamos dirección completa y zona si corresponde)":"retiro en local").join(" o ")+". "+current.product.deliveryConfig.instructions};
  }
  const snapshots:Array<DeliverySnapshot&{quantity:number}>=[];
  for(const item of selections){
    const snapshot=await deliveryService.validate(session.businessId,item.product.productId,item.quantity,item.input,item.deliverySelection,manualShipping);
    snapshots.push({...snapshot,quantity:item.quantity});
  }
  const first=snapshots[0]!;
  if(snapshots.some(s=>s.mode!==first.mode||Boolean(s.physical)!==Boolean(first.physical)))throw new AppError("Este carrito combina entregas que requieren coordinación. Solicite un agente antes de pagar",409,"CART_DELIVERY_REQUIRES_REVIEW");
  const requests=selections.map(item=>({productId:item.product.productId,quantity:item.quantity,...(item.deliverySelection?{delivery:item.deliverySelection}:{})}));
  const quote=await gateway.createQuote(session.businessId,{...requests[0]!,customerId:session.customerId,...(requests.length>1?{additionalItems:requests.slice(1)}:{})},manualShipping);
  if(!isDeepStrictEqual(quote.delivery??null,first.physical??null))throw new AppError("La tarifa cambió. Revise la entrega antes de continuar",409,"DELIVERY_CONFIGURATION_CHANGED");
  const delivery:DeliverySnapshot={mode:first.mode,productId:first.productId,mappingId:first.mappingId,providerServiceId:first.providerServiceId,input:first.input,
    ...(first.physical?{physical:first.physical}:{}),...(first.digitalContents?{digitalContents:first.digitalContents}:{}),...(snapshots.length>1?{items:snapshots}:{})};
  const lines=selections.map(item=>{
    const quoted=quote.items?.find(line=>line.productId===item.product.productId);
    return `Producto/servicio: ${quoted?.productName??quote.productName}\n${item.product.description?.trim()?item.product.description.trim()+"\n":""}Cantidad: ${item.quantity}\n`+
      (quoted?`Valor: ${formatMoney(quoted.totalPrice,quote.currency)}\n`:"")+
      Object.entries(item.input).map(([key,value])=>`${item.product.requiredInputs.find(f=>f.key===key)?.label??key}: ${value}`).join("\n");
  });
  const text="Resumen de tu compra:\n"+lines.join("\n\n")+"\n"+
    (quote.delivery?`Productos: ${formatMoney(quote.totalPrice-quote.delivery.fee,quote.currency)}\n${quote.delivery.method==="pickup"?"Retiro en local":"Despacho a domicilio"}: ${quote.delivery.address}\n${quote.delivery.zone?"Zona: "+quote.delivery.zone+"\n":""}Envío: ${formatMoney(quote.delivery.fee,quote.currency)}\n${quote.delivery.instructions}\n`:"")+
    `Total: ${formatMoney(quote.totalPrice,quote.currency)}\n¿Están correctos los datos? Puede confirmar, añadir otro producto o cambiar la compra antes de pagar.`;
  if(text.length>8000||Buffer.byteLength(JSON.stringify(text),"utf8")>24000)throw new AppError("El detalle del carrito es demasiado extenso para enviarlo íntegro por este canal. Solicite un agente antes del pago",409,"CART_SUMMARY_TOO_LARGE");
  const checkout=await repository.createCheckout(session,quote.quoteId,delivery);
  session.state.checkoutId=checkout.id;session.state.phase="confirm";
  return {text,summaryText:text};
}
