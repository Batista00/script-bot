import type { PostgresSalesRepository } from "./sales.repository.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { SalesCheckoutService } from "./sales-checkout.service.js";
import { salesContext } from "./sales-context.js";
import { AppError } from "../../core/errors/app-error.js";
import type { SalesSession, SalesSettings } from "./sales.types.js";

/** Read-only preparation: the model sees real state before it chooses an action. */
export async function prepareAgentContext(repository:PostgresSalesRepository,gateway:BotGatewayService,checkout:SalesCheckoutService,businessId:string,sessionId:string) {
  const session=await repository.session(businessId,sessionId),settings=await repository.settings(businessId);
  if(!settings.enabled)throw new AppError("Ventas desactivadas",409,"SALES_DISABLED");
  if(session.paused||session.state.optedOut)return {text:"",paused:true,context:salesContext(session,settings)};
  return {text:"Contexto actualizado. Converse con el cliente y use una acción únicamente cuando necesite consultar o modificar la compra.",
    context:await agentContext(repository,gateway,checkout,session,settings)};
}

export async function agentContext(repository:PostgresSalesRepository,gateway:BotGatewayService,checkout:SalesCheckoutService,session:SalesSession,settings:SalesSettings) {
  const [categories,methods]=await Promise.all([repository.commercialCategories(session.businessId),gateway.listPaymentMethods(session.businessId)]);
  const order=session.state.checkoutId?await checkout.status(session):null;
  return {...salesContext(session,settings),categories,
    paymentMethods:methods.map(m=>({methodId:m.paymentMethodId,name:m.name,type:m.type})),verifiedOrderStatus:order?.text??null};
}
