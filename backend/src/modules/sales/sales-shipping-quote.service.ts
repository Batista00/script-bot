import { z } from "zod";
import { createHash } from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesCheckoutService } from "./sales-checkout.service.js";
import type { PostgresNotificationsRepository } from "../automation/notifications.repository.js";

export const shippingQuoteSchema=z.object({requestId:z.string().uuid(),fee:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),address:z.string().trim().min(8).max(500)}).strict();

/** Staff-only quote, with actor attribution and idempotent summary notification. Does not charge. */
export class SalesShippingQuoteService {
  constructor(private readonly sales:PostgresSalesRepository,private readonly checkout:SalesCheckoutService,private readonly notifications:PostgresNotificationsRepository){}
  async quote(businessId:string,sessionId:string,userId:string,input:z.infer<typeof shippingQuoteSchema>){
    return this.sales.exclusive(sessionId,async()=>{
      const session=await this.sales.session(businessId,sessionId);
      if(session.state.optedOut)throw new AppError("El cliente desactivó los mensajes",409,"CONTACT_OPTED_OUT");
      const messageId=`shipping-quote:${input.requestId}`,hash=createHash("sha256").update(JSON.stringify({userId,fee:input.fee,address:input.address})).digest("hex");
      const previous=await this.sales.message(session,messageId);
      if(previous&&previous.requestHash!==hash)throw new AppError("Esta solicitud ya tiene otro contenido",409,"SALES_MESSAGE_CONFLICT");
      let response=previous?.response;
      if(!response){
        if(session.state.phase!=="delivery")throw new AppError("Sólo puede cotizar el envío pendiente antes de confirmar y pagar",409,"SALES_STEP_NOT_ALLOWED");
        await this.sales.beginMessage(session,messageId,hash);
        session.state.deliverySelection={method:"shipping",address:input.address};
        // The entire physical cart shares the confirmed address and a single shipping fee.
        for(const item of session.state.cart??[])item.deliverySelection=session.state.deliverySelection;
        response=await this.checkout.quote(session,{fee:input.fee,quotedBy:userId,quotedAt:new Date().toISOString()});
        session.paused=false;
        await this.sales.finishMessage(session,messageId,response);
      }
      await this.notifications.enqueue(businessId,`${sessionId}:${messageId}`,"whatsapp",{contact:session.contact,text:response.text});
      return {ok:true,text:response.text};
    });
  }
}
