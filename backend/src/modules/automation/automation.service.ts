import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { PostgresSalesRepository } from "../sales/sales.repository.js";
import type { SalesDeliveryService } from "../sales/sales-delivery.service.js";
import type { SalesCheckout, SalesSettings } from "../sales/sales.types.js";
import type { PaymentReviewsService } from "../payment-reviews/payment-reviews.service.js";
import type { PostgresNotificationsRepository, Notification } from "./notifications.repository.js";
import type { DigitalDeliveryService } from "../digital-delivery/digital-delivery.service.js";

export class AutomationService {
  constructor(private readonly sales:PostgresSalesRepository,private readonly gateway:BotGatewayService,
    private readonly delivery:SalesDeliveryService,private readonly notifications:PostgresNotificationsRepository,
    private readonly reviews:PaymentReviewsService,private readonly digital?:DigitalDeliveryService) {}
  async tick(businessId:string) {
      const settings=await this.sales.settings(businessId);
      if (!settings.enabled) return {processed:0,disabled:true};
      await this.sales.cleanExpired(businessId,settings.evidenceRetentionDays);
      await this.digital?.reconcile(businessId);
      for (const sessionId of await this.sales.inactiveSessions(businessId)) {
        try { await this.sales.exclusive(sessionId,()=>this.sales.closeInactiveSession(businessId,sessionId)); }
        catch(error) { if (!(error instanceof AppError) || error.code!=="SALES_BUSY") throw error; }
      }
      let processed=0;
      for (const checkout of await this.sales.due(businessId)) {
        try {
          await this.sales.exclusive(checkout.sessionId,()=>this.reconcile(checkout,settings));
          processed++;
        } catch(error) {
          if (!(error instanceof AppError) || error.code!=="SALES_BUSY") throw error;
        }
      }
      return {processed,disabled:false};
  }
  private async reconcile(checkout:SalesCheckout,settings:SalesSettings):Promise<void> {
    const businessId=checkout.businessId;
    const session=await this.sales.session(businessId,checkout.sessionId);
    let order=await this.gateway.getOrder(businessId,checkout.orderId!);
    let attention:string|null=null;
    let providerOrderReference:string|null=null;
    if (order.status==="paid" || order.status==="processing" || order.status==="completed") {
      if (!session.state.optedOut) await this.notifications.enqueue(businessId,`paid:${order.orderId}`,"whatsapp",{
        contact:session.contact,text:`Tu pago fue confirmado. Pedido ${order.orderId}. Te informaremos de su entrega.`,
      });
      await this.notifications.enqueue(businessId,`paid-admin:${order.orderId}`,"telegram",{
        chatId:settings.telegramChatId,text:`PAGO CONFIRMADO\nPedido ${order.orderId}\n${order.total} ${order.currency}\nCliente ${session.contact}\n`+
          (order.items ?? []).map(item=>`${item.productName}: ${item.quantity}`).join("\n")+(order.delivery?`\nEntrega: ${order.delivery.method==="pickup"?"Retiro":"Domicilio"}\n${order.delivery.address}\n${order.delivery.zone??""}\nCosto: ${order.delivery.fee} ${order.currency}\n`:"")+"\nConfirmación: CONFIRMADO. No requiere aprobar otra vez.",
      });
    }
    try {
      if (checkout.delivery.mode==="manual" && order.status==="paid") attention="MANUAL_DELIVERY_REQUIRED";
      if(checkout.delivery.mode==="digital"&&["paid","processing"].includes(order.status)&&!session.state.optedOut){
        if(!this.digital)throw new AppError("Entrega digital no configurada",409,"DELIVERY_NOT_CONFIGURED");
        await this.digital.enqueue(businessId,order.orderId,session.contact);
      }
      if (checkout.delivery.mode==="provider") {
        let fulfillments=await this.gateway.listFulfillments(businessId,order.orderId);
        if (["paid","processing"].includes(order.status) && settings.autoDispatch) {
          if (!order.items.length) throw new AppError("El pedido no tiene un ítem válido",409,"ORDER_ITEM_NOT_FOUND");
          const pending=order.items.filter(item=>{const existing=fulfillments.find(f=>f.orderItemId===item.orderItemId);return !existing||existing.status==="pending";});
          if(pending.length)await this.delivery.revalidate(businessId,order.items[0]!.quantity,checkout.delivery);
          for(const item of pending){
            const delivery=(checkout.delivery.items??[checkout.delivery]).find(d=>d.productId===item.productId);
            if(!delivery?.providerServiceId)throw new AppError("Falta la entrega de un producto del carrito",409,"SALES_DELIVERY_CHANGED");
            await this.gateway.dispatchFulfillment(businessId,order.orderId,{orderItemId:item.orderItemId,input:delivery.input},delivery.providerServiceId);
          }
          if(pending.length)fulfillments=await this.gateway.listFulfillments(businessId,order.orderId);
        }
        for (const fulfillment of fulfillments) {
          providerOrderReference=fulfillment.providerOrderReference ?? providerOrderReference;
          if (["submitted","in_progress"].includes(fulfillment.status)) await this.gateway.syncFulfillment(businessId,fulfillment.fulfillmentId);
          else if (["submission_unknown","submitting","failed","partial","cancelled"].includes(fulfillment.status)) {
            attention=`FULFILLMENT_${fulfillment.status.toUpperCase()}`;
          }
        }
      }
    } catch(error) { attention=error instanceof AppError ? error.code : "AUTOMATION_OPERATION_FAILED"; }
    order=await this.gateway.getOrder(businessId,order.orderId);
    if (attention) await this.notifications.enqueue(businessId,`attention:${order.orderId}:${attention}`,"telegram",{
      chatId:settings.telegramChatId,text:`REVISIÓN OPERATIVA\nPedido ${order.orderId}\n${attention}\nNo repitas compras externas sin verificar su resultado.`,
    });
    if (!session.state.optedOut && checkout.lastOrderStatus!==order.status && ["processing","completed","failed","cancelled"].includes(order.status)) {
      const names:Record<string,string>={processing:"en proceso de entrega",completed:"entregado",failed:"requiere revisión del equipo",cancelled:"cancelado"};
      await this.notifications.enqueue(businessId,`order:${order.orderId}:${order.status}`,"whatsapp",{
        contact:session.contact,text:`Tu pedido ${order.orderId} está ${names[order.status]}.`+
          (providerOrderReference ? `\nReferencia del proveedor: ${providerOrderReference}.` : ""),
      });
    }
    // Reconciliation derives work from durable Orders; payment webhooks need not notify n8n directly.
    await this.sales.checkpoint(checkout,order.status,attention,["completed","cancelled"].includes(order.status));
  }
  async claim(businessId:string):Promise<Notification[]> {
    const settings=await this.sales.settings(businessId);
    if (!settings.enabled) return [];
    const jobs=await this.notifications.claim(businessId);
    return Promise.all(jobs.map(async(job)=>{
      if(typeof job.payload.digitalDeliveryId==="string"){
        if(!this.digital)throw new AppError("Entrega digital no configurada",409,"DELIVERY_NOT_CONFIGURED");
        return {...job,payload:{...job.payload,text:await this.digital.content(businessId,job.payload.digitalDeliveryId)}};
      }
      if (typeof job.payload.reviewId!=="string") return job;
      try {
        const review=await this.reviews.notification(businessId,job.payload.reviewId);
        return {...job,payload:{...job.payload,...(job.payload.reviewPresentation==="text"
          ? {replyMarkup:review.replyMarkup} : review)}};
      }
      catch { return {...job,payload:{chatId:settings.telegramChatId,text:"Hay un comprobante no disponible para revisión; consulta el panel."}}; }
    }));
  }
}
