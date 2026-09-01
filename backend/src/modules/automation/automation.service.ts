import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { PostgresSalesRepository } from "../sales/sales.repository.js";
import type { SalesDeliveryService } from "../sales/sales-delivery.service.js";
import type { SalesCheckout, SalesSettings } from "../sales/sales.types.js";
import type { PaymentReviewsService } from "../payment-reviews/payment-reviews.service.js";
import type { PostgresNotificationsRepository } from "./notifications.repository.js";

export class AutomationService {
  constructor(private readonly sales:PostgresSalesRepository,private readonly gateway:BotGatewayService,
    private readonly delivery:SalesDeliveryService,private readonly notifications:PostgresNotificationsRepository,
    private readonly reviews:PaymentReviewsService) {}
  async tick(businessId:string) {
      const settings=await this.sales.settings(businessId);
      if (!settings.enabled) return {processed:0,disabled:true};
      await this.sales.cleanExpired(businessId,settings.evidenceRetentionDays);
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
    if (order.status==="paid" || order.status==="processing" || order.status==="completed") {
      if (!session.state.optedOut) await this.notifications.enqueue(businessId,`paid:${order.orderId}`,"whatsapp",{
        contact:session.contact,text:`Tu pago fue confirmado. Pedido ${order.orderId}. Te informaremos de su entrega.`,
      });
      await this.notifications.enqueue(businessId,`paid-admin:${order.orderId}`,"telegram",{
        chatId:settings.telegramChatId,text:`PAGO CONFIRMADO\nPedido ${order.orderId}\n${order.total} ${order.currency}\nCliente ${session.contact}`,
      });
    }
    try {
      if (checkout.delivery.mode==="manual" && order.status==="paid") attention="MANUAL_DELIVERY_REQUIRED";
      if (checkout.delivery.mode==="provider") {
        let fulfillments=await this.gateway.listFulfillments(businessId,order.orderId);
        const existing=fulfillments[0];
        if (order.status==="paid" && settings.autoDispatch && (!existing || existing.status==="pending")) {
          const item=order.items[0];
          if (!item) throw new AppError("El pedido no tiene un ítem válido",409,"ORDER_ITEM_NOT_FOUND");
          await this.delivery.revalidate(businessId,item.quantity,checkout.delivery);
          await this.gateway.dispatchFulfillment(businessId,order.orderId,{orderItemId:item.orderItemId,input:checkout.delivery.input},checkout.delivery.providerServiceId!);
          fulfillments=await this.gateway.listFulfillments(businessId,order.orderId);
        }
        for (const fulfillment of fulfillments) {
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
        contact:session.contact,text:`Tu pedido ${order.orderId} está ${names[order.status]}.`,
      });
    }
    // Reconciliation derives work from durable Orders; payment webhooks need not notify n8n directly.
    await this.sales.checkpoint(checkout,order.status,attention,["completed","cancelled"].includes(order.status));
  }
  async claim(businessId:string) {
    const settings=await this.sales.settings(businessId);
    if (!settings.enabled) return [];
    const jobs=await this.notifications.claim(businessId);
    return Promise.all(jobs.map(async(job)=>{
      if (typeof job.payload.reviewId!=="string") return job;
      try { return {...job,payload:{...job.payload,...await this.reviews.notification(businessId,job.payload.reviewId)}}; }
      catch { return {...job,payload:{chatId:settings.telegramChatId,text:"Hay un comprobante no disponible para revisión; consulta el panel."}}; }
    }));
  }
}
